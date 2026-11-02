import db from '../db.js';

export class SalaryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EDITABLE = ['entry_date', 'agent_id', 'basic_salary', 'advance', 'deduction', 'note'];
const LABELS = { basic_salary: 'Basic salary', advance: 'Advance', deduction: 'Deduction', amount: 'Allowance' };

const tidyName = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
const fmt = (n) => Number(n).toFixed(2);
const round2 = (n) => Math.round(n * 100) / 100;

function money(v, key) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = parseFloat(v);
  if (Number.isNaN(n) || n < 0 || n >= 1e12) throw new SalaryError(400, `${LABELS[key] || 'Amount'} must be zero or more.`);
  return n;
}

function validDate(v) {
  if (!DATE_RE.test(v || '') || Number.isNaN(Date.parse(v))) throw new SalaryError(400, 'Pick a valid date.');
  return v;
}

// [first day of the month, first day of the next month) for a 'YYYY-MM' string.
function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return [`${month}-01`, next];
}

// The allowance types offered in each row's Allowances dropdown.
export async function listTypes() {
  return db('salary_types').where({ is_active: true, kind: 'allowance' }).orderBy([{ column: 'sort_order' }, { column: 'created_at' }]).select('id', 'name');
}

// Adds an allowance type. A name that already exists (any case) is reused.
export async function createType(name, actorId) {
  const clean = tidyName(name);
  if (!clean) throw new SalaryError(400, 'Type a name for the new allowance type.');
  if (clean.length > 80) throw new SalaryError(400, 'The name is too long (80 characters at most).');
  const existing = await db('salary_types').whereRaw('lower(name) = lower(?)', [clean]).first();
  if (existing) {
    if (!existing.is_active || existing.kind !== 'allowance') await db('salary_types').where({ id: existing.id }).update({ is_active: true, kind: 'allowance' });
    return { id: existing.id, name: existing.name };
  }
  const [{ max }] = await db('salary_types').max('sort_order as max');
  const [row] = await db('salary_types').insert({ name: clean, kind: 'allowance', sort_order: (max ?? -1) + 1 }).returning(['id', 'name']);
  await db('audit_logs').insert({ actor_id: actorId, action_type: 'SALARY_TYPE_CREATED', description: `Added allowance type '${clean}'.` });
  return row;
}

const entryQuery = (k) => k('salary_entries as e')
  .join('users as u', 'u.id', 'e.agent_id')
  .select('e.id', 'e.agent_id', 'u.name as agent_name', 'e.note',
    k.raw("to_char(e.entry_date, 'YYYY-MM-DD') as entry_date"),
    k.raw('e.basic_salary::float8 as basic_salary'), k.raw('e.advance::float8 as advance'), k.raw('e.deduction::float8 as deduction'));

// Adds each row's allowance lines, their total, and the net salary.
async function finish(k, entries) {
  if (!entries.length) return [];
  const lines = await k('salary_entry_allowances as a')
    .join('salary_types as t', 't.id', 'a.type_id')
    .whereIn('a.entry_id', entries.map((e) => e.id))
    .orderBy([{ column: 't.sort_order' }, { column: 't.created_at' }])
    .select('a.id', 'a.entry_id', 'a.type_id', 't.name as type_name', k.raw('a.amount::float8 as amount'));
  return entries.map((e) => {
    const allowances = lines.filter((l) => l.entry_id === e.id).map(({ entry_id, ...l }) => l);
    const allowance_total = round2(allowances.reduce((s, l) => s + l.amount, 0));
    return { ...e, allowances, allowance_total, net: round2(e.basic_salary + allowance_total + e.advance - e.deduction) };
  });
}

async function getEntry(k, id) {
  const e = await entryQuery(k).where('e.id', id).first();
  return e ? (await finish(k, [e]))[0] : null;
}

// Entries for a month (blank = all time), oldest first, optionally narrowed.
// Narrowing by allowance type keeps the rows that have that allowance.
export async function listEntries({ month, agentId, typeId }) {
  if (month && !MONTH_RE.test(month)) throw new SalaryError(400, 'Month must look like 2026-11.');
  const q = entryQuery(db);
  if (month) {
    const [from, to] = monthBounds(month);
    q.where('e.entry_date', '>=', from).where('e.entry_date', '<', to);
  }
  if (agentId) q.where('e.agent_id', agentId);
  if (typeId) q.whereIn('e.id', db('salary_entry_allowances').select('entry_id').where({ type_id: typeId }));
  const [entries, types] = await Promise.all([
    q.orderBy([{ column: 'e.entry_date', order: 'asc' }, { column: 'e.created_at', order: 'asc' }]).limit(1000),
    listTypes()
  ]);
  return { entries: await finish(db, entries), types };
}

async function requireAgent(agentId) {
  const agent = agentId ? await db('users').where({ id: agentId, is_active: true }).first('id', 'name') : null;
  if (!agent) throw new SalaryError(400, 'Choose the employee.');
  return agent;
}

async function requireType(typeId) {
  const t = typeId ? await db('salary_types').where({ id: typeId, is_active: true, kind: 'allowance' }).first('id', 'name') : null;
  if (!t) throw new SalaryError(400, 'Choose an allowance type.');
  return t;
}

// The employee's saved basic salary, used to fill a new row's Basic Salary when none is
// typed. Only for their first row of the month, so an advance or second payment does not
// repeat the full salary.
async function defaultBasic(agentId, entryDate) {
  if (!(await detailsTableExists())) return 0;
  const details = await db('salary_employee_details').where({ agent_id: agentId }).first('basic_salary');
  if (!details) return 0;
  const [from, to] = monthBounds(entryDate.slice(0, 7));
  const existing = await db('salary_entries').where('agent_id', agentId).where('entry_date', '>=', from).where('entry_date', '<', to).first('id');
  return existing ? 0 : Number(details.basic_salary) || 0;
}

export async function createEntry(input, actorId) {
  const agent = await requireAgent(input.agent_id);
  const entryDate = validDate(input.entry_date || today());
  const typedBasic = input.basic_salary !== undefined && input.basic_salary !== null && input.basic_salary !== '';
  const row = {
    entry_date: entryDate,
    agent_id: agent.id,
    basic_salary: typedBasic ? money(input.basic_salary, 'basic_salary') : await defaultBasic(agent.id, entryDate),
    advance: money(input.advance, 'advance'),
    deduction: money(input.deduction, 'deduction'),
    note: typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null,
    // A row is entered when the money is given, so it is recorded as given straight away.
    status: 'paid',
    paid_on: entryDate,
    created_by: actorId
  };
  const [created] = await db('salary_entries').insert(row).returning('id');
  const id = created.id ?? created;
  await db('audit_logs').insert({
    actor_id: actorId, action_type: 'SALARY_ENTRY_ADDED',
    description: `Salary row for ${agent.name} on ${row.entry_date}: basic ${fmt(row.basic_salary)}, advance ${fmt(row.advance)}, deduction ${fmt(row.deduction)}.`
  });
  return getEntry(db, id);
}

// Locks the row for the change that follows.
async function editableEntry(trx, id) {
  const cur = await trx('salary_entries').where({ id }).first().forUpdate();
  if (!cur) throw new SalaryError(404, 'That row was not found.');
  return cur;
}

// Changes some of a row's own fields (date, employee, basic salary, deductions, note).
export async function updateEntry(id, patch, actorId) {
  return db.transaction(async (trx) => {
    const cur = await editableEntry(trx, id);
    const updates = {};
    const changes = [];
    for (const key of EDITABLE) {
      if (!(key in patch)) continue;
      let value = patch[key];
      if (key === 'entry_date') value = validDate(value);
      else if (key === 'agent_id') value = (await requireAgent(value)).id;
      else if (key === 'note') value = typeof value === 'string' && value.trim() ? value.trim() : null;
      else value = money(value, key);
      const before = key === 'basic_salary' || key === 'advance' || key === 'deduction' ? Number(cur[key]) : cur[key];
      const same = key === 'entry_date' ? new Date(before).toLocaleDateString('sv-SE') === value : before === value || (before == null && value == null);
      if (!same) { updates[key] = value; changes.push(`${key}: ${before ?? '-'} -> ${value ?? '-'}`); }
    }
    if (!changes.length) return getEntry(trx, id);

    updates.updated_at = trx.fn.now();
    await trx('salary_entries').where({ id }).update(updates);
    await trx('audit_logs').insert({ actor_id: actorId, action_type: 'SALARY_ENTRY_EDITED', description: `Salary row ${id} changed: ${changes.join(', ')}.` });
    return getEntry(trx, id);
  });
}

// --- Allowance lines inside a row -------------------------------------------

export async function addAllowance(entryId, { type_id, amount }, actorId) {
  const type = await requireType(type_id);
  const value = money(amount, 'amount');
  return db.transaction(async (trx) => {
    await editableEntry(trx, entryId);
    const dup = await trx('salary_entry_allowances').where({ entry_id: entryId, type_id: type.id }).first('id');
    if (dup) throw new SalaryError(409, `This row already has ${type.name}. Change its amount instead.`);
    await trx('salary_entry_allowances').insert({ entry_id: entryId, type_id: type.id, amount: value });
    const e = await getEntry(trx, entryId);
    await trx('audit_logs').insert({ actor_id: actorId, action_type: 'SALARY_ALLOWANCE_ADDED', description: `${e.agent_name} ${e.entry_date}: added ${type.name} ${fmt(value)}.` });
    return e;
  });
}

export async function updateAllowance(entryId, lineId, patch, actorId) {
  return db.transaction(async (trx) => {
    await editableEntry(trx, entryId);
    const line = await trx('salary_entry_allowances as a').join('salary_types as t', 't.id', 'a.type_id')
      .where({ 'a.id': lineId, 'a.entry_id': entryId }).first('a.type_id', 'a.amount', 't.name as type_name');
    if (!line) throw new SalaryError(404, 'That allowance was not found.');
    const updates = {};
    let label = line.type_name;
    if ('type_id' in patch && patch.type_id !== line.type_id) {
      const type = await requireType(patch.type_id);
      const dup = await trx('salary_entry_allowances').where({ entry_id: entryId, type_id: type.id }).whereNot('id', lineId).first('id');
      if (dup) throw new SalaryError(409, `This row already has ${type.name}. Change its amount instead.`);
      updates.type_id = type.id;
      label = `${line.type_name} -> ${type.name}`;
    }
    if ('amount' in patch) updates.amount = money(patch.amount, 'amount');
    if (Object.keys(updates).length) {
      await trx('salary_entry_allowances').where({ id: lineId }).update(updates);
      const e = await getEntry(trx, entryId);
      await trx('audit_logs').insert({
        actor_id: actorId, action_type: 'SALARY_ALLOWANCE_EDITED',
        description: `${e.agent_name} ${e.entry_date}: ${label}${'amount' in updates ? ` ${fmt(line.amount)} -> ${fmt(updates.amount)}` : ''}.`
      });
    }
    return getEntry(trx, entryId);
  });
}

export async function deleteAllowance(entryId, lineId, actorId) {
  return db.transaction(async (trx) => {
    await editableEntry(trx, entryId);
    const line = await trx('salary_entry_allowances as a').join('salary_types as t', 't.id', 'a.type_id')
      .where({ 'a.id': lineId, 'a.entry_id': entryId }).first('a.amount', 't.name as type_name');
    if (!line) throw new SalaryError(404, 'That allowance was not found.');
    await trx('salary_entry_allowances').where({ id: lineId }).delete();
    const e = await getEntry(trx, entryId);
    await trx('audit_logs').insert({ actor_id: actorId, action_type: 'SALARY_ALLOWANCE_REMOVED', description: `${e.agent_name} ${e.entry_date}: removed ${line.type_name} ${fmt(line.amount)}.` });
    return e;
  });
}

// --- Delete ---------------------------------------------------------------------

export async function deleteEntry(id, actorId) {
  const cur = await getEntry(db, id);
  if (!cur) throw new SalaryError(404, 'That row was not found.');
  await db('salary_entries').where({ id }).delete(); // its allowance lines go with it
  await db('audit_logs').insert({
    actor_id: actorId, action_type: 'SALARY_ENTRY_DELETED',
    description: `Deleted ${cur.agent_name}'s ${cur.entry_date} salary row (net ${fmt(cur.net)}).`
  });
}

// --- Employee details (basic salary + bank) -----------------------------------

const DETAIL_FIELDS = ['bank_name', 'bank_branch', 'account_holder', 'account_number'];
const EMPLOYEE_ROLES = ['agent', 'admin'];

// The details table is created by the setup script; until it exists the portal still works,
// just without saved details.
async function detailsTableExists() {
  return db.schema.hasTable('salary_employee_details');
}

// Everyone who can be paid (active agents and admins) with their saved details, if any.
export async function listEmployees() {
  const ready = await detailsTableExists();
  const q = db('users as u').whereIn('u.role', EMPLOYEE_ROLES).where('u.is_active', true).orderBy('u.name').select('u.id', 'u.name', 'u.role');
  if (ready) {
    q.leftJoin('salary_employee_details as d', 'd.agent_id', 'u.id')
      .select(db.raw('d.basic_salary::float8 as basic_salary'), 'd.bank_name', 'd.bank_branch', 'd.account_holder', 'd.account_number');
  }
  const rows = await q;
  return {
    detailsReady: ready,
    employees: rows.map((r) => ({
      id: r.id, name: r.name, role: r.role,
      basic_salary: r.basic_salary || 0,
      bank_name: r.bank_name || '', bank_branch: r.bank_branch || '',
      account_holder: r.account_holder || '', account_number: r.account_number || ''
    }))
  };
}

const maskAccount = (n) => (n ? `••••${String(n).slice(-4)}` : 'none');

// Saves one employee's basic salary and bank details.
export async function saveEmployeeDetails(agentId, input, actorId) {
  if (!(await detailsTableExists())) throw new SalaryError(503, 'The salary setup has not been run on the database yet (scripts/salary-portal.sql).');
  const agent = await db('users').where({ id: agentId, is_active: true }).whereIn('role', EMPLOYEE_ROLES).first('id', 'name');
  if (!agent) throw new SalaryError(404, 'That employee was not found.');

  const basic = money(input.basic_salary, 'basic_salary');
  const clean = {};
  for (const key of DETAIL_FIELDS) {
    const v = typeof input[key] === 'string' ? input[key].trim().replace(/\s+/g, ' ') : '';
    if (v.length > (key === 'account_holder' ? 150 : 100)) throw new SalaryError(400, 'One of the bank fields is too long.');
    clean[key] = v || null;
  }
  if (clean.account_number) {
    clean.account_number = clean.account_number.replace(/\s+/g, '');
    if (!/^[0-9A-Za-z-]{4,30}$/.test(clean.account_number)) throw new SalaryError(400, 'The account number should be 4 to 30 letters or digits.');
  }

  const before = await db('salary_employee_details').where({ agent_id: agent.id }).first();
  await db('salary_employee_details').insert({ agent_id: agent.id, basic_salary: basic, ...clean, updated_at: db.fn.now() })
    .onConflict('agent_id').merge();

  const changes = [];
  if (Number(before?.basic_salary || 0) !== basic) changes.push(`basic salary ${fmt(before?.basic_salary || 0)} -> ${fmt(basic)}`);
  if ((before?.bank_name || null) !== clean.bank_name) changes.push('bank name');
  if ((before?.bank_branch || null) !== clean.bank_branch) changes.push('bank branch');
  if ((before?.account_holder || null) !== clean.account_holder) changes.push('account holder');
  if ((before?.account_number || null) !== clean.account_number) changes.push(`account number ${maskAccount(before?.account_number)} -> ${maskAccount(clean.account_number)}`);
  if (changes.length) {
    await db('audit_logs').insert({ actor_id: actorId, action_type: 'SALARY_EMPLOYEE_DETAILS', description: `Updated ${agent.name}'s salary details: ${changes.join(', ')}.` });
  }
  return { id: agent.id, name: agent.name, basic_salary: basic, bank_name: clean.bank_name || '', bank_branch: clean.bank_branch || '', account_holder: clean.account_holder || '', account_number: clean.account_number || '' };
}
