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
  .select('e.id', 'e.agent_id', 'u.name as agent_name', 'e.status', 'e.note',
    k.raw("to_char(e.entry_date, 'YYYY-MM-DD') as entry_date"), k.raw("to_char(e.paid_on, 'YYYY-MM-DD') as paid_on"),
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
export async function listEntries({ month, agentId, typeId, status }) {
  if (month && !MONTH_RE.test(month)) throw new SalaryError(400, 'Month must look like 2026-11.');
  if (status && !['pending', 'paid'].includes(status)) throw new SalaryError(400, 'Status must be pending or paid.');
  const q = entryQuery(db);
  if (month) {
    const [from, to] = monthBounds(month);
    q.where('e.entry_date', '>=', from).where('e.entry_date', '<', to);
  }
  if (agentId) q.where('e.agent_id', agentId);
  if (typeId) q.whereIn('e.id', db('salary_entry_allowances').select('entry_id').where({ type_id: typeId }));
  if (status) q.where('e.status', status);
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

// One open (unpaid) row per employee per month: further allowances go on that row.
// Once a row is marked Paid the employee can get a new row (another payment, an advance...).
async function assertOneRowPerMonth(k, agent, entryDate, exceptId) {
  const [from, to] = monthBounds(entryDate.slice(0, 7));
  const q = k('salary_entries').where('agent_id', agent.id).where('status', 'pending').where('entry_date', '>=', from).where('entry_date', '<', to);
  if (exceptId) q.whereNot('id', exceptId);
  if (await q.first('id')) throw new SalaryError(409, `${agent.name} already has an unpaid row for ${entryDate.slice(0, 7)}. Add to that row, or mark it Paid first.`);
}

export async function createEntry(input, actorId) {
  const agent = await requireAgent(input.agent_id);
  const row = {
    entry_date: validDate(input.entry_date || today()),
    agent_id: agent.id,
    basic_salary: money(input.basic_salary, 'basic_salary'),
    advance: money(input.advance, 'advance'),
    deduction: money(input.deduction, 'deduction'),
    note: typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null,
    created_by: actorId
  };
  await assertOneRowPerMonth(db, agent, row.entry_date);
  const [created] = await db('salary_entries').insert(row).returning('id');
  const id = created.id ?? created;
  await db('audit_logs').insert({
    actor_id: actorId, action_type: 'SALARY_ENTRY_ADDED',
    description: `Salary row for ${agent.name} on ${row.entry_date}: basic ${fmt(row.basic_salary)}, advance ${fmt(row.advance)}, deduction ${fmt(row.deduction)}.`
  });
  return getEntry(db, id);
}

// Locks the row for editing, or refuses when it is already paid.
async function editableEntry(trx, id) {
  const cur = await trx('salary_entries').where({ id }).first().forUpdate();
  if (!cur) throw new SalaryError(404, 'That row was not found.');
  if (cur.status === 'paid') throw new SalaryError(409, 'This row is marked Paid. Press "Undo" on it before changing it.');
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

    if (updates.agent_id || updates.entry_date) {
      const agent = await trx('users').where({ id: updates.agent_id || cur.agent_id }).first('id', 'name');
      await assertOneRowPerMonth(trx, agent, updates.entry_date || new Date(cur.entry_date).toLocaleDateString('sv-SE'), id);
    }
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

// --- Paid / delete ------------------------------------------------------------

// Marks a row paid (locks it) or undoes that.
export async function setPaid(id, paid, actorId) {
  return db.transaction(async (trx) => {
    const cur = await getEntry(trx, id);
    if (!cur) throw new SalaryError(404, 'That row was not found.');
    const wanted = paid ? 'paid' : 'pending';
    if (cur.status === wanted) return cur;
    if (paid && !(cur.net > 0)) throw new SalaryError(400, 'Enter an amount first.');
    await trx('salary_entries').where({ id }).update({ status: wanted, paid_on: paid ? today() : null, updated_at: trx.fn.now() });
    await trx('audit_logs').insert({
      actor_id: actorId, action_type: paid ? 'SALARY_PAID' : 'SALARY_UNPAID',
      description: paid ? `Marked ${cur.agent_name}'s ${cur.entry_date} salary row (net ${fmt(cur.net)}) as paid.` : `Undid Paid on ${cur.agent_name}'s ${cur.entry_date} salary row.`
    });
    return getEntry(trx, id);
  });
}

export async function deleteEntry(id, actorId) {
  const cur = await getEntry(db, id);
  if (!cur) throw new SalaryError(404, 'That row was not found.');
  if (cur.status === 'paid') throw new SalaryError(409, 'This row is marked Paid. Press "Undo" on it before deleting.');
  await db('salary_entries').where({ id }).delete(); // its allowance lines go with it
  await db('audit_logs').insert({
    actor_id: actorId, action_type: 'SALARY_ENTRY_DELETED',
    description: `Deleted ${cur.agent_name}'s ${cur.entry_date} salary row (net ${fmt(cur.net)}).`
  });
}
