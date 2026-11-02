import db from '../db.js';

export class SalaryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONEY_FIELDS = ['basic_salary', 'allowance_amount', 'deduction'];
const EDITABLE = ['entry_date', 'agent_id', 'basic_salary', 'allowance_type_id', 'allowance_amount', 'deduction', 'note'];

const tidyName = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
const fmt = (n) => Number(n).toFixed(2);

function money(v, label) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = parseFloat(v);
  if (Number.isNaN(n) || n < 0 || n >= 1e12) throw new SalaryError(400, `${label} must be zero or more.`);
  return n;
}

function validDate(v) {
  if (!DATE_RE.test(v || '') || Number.isNaN(Date.parse(v))) throw new SalaryError(400, 'Pick a valid date.');
  return v;
}

// The allowance types shown in the Allowances dropdown.
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
  .leftJoin('salary_types as t', 't.id', 'e.allowance_type_id')
  .select('e.id', 'e.agent_id', 'u.name as agent_name', 'e.allowance_type_id', 't.name as allowance_type_name',
    'e.status', 'e.note',
    k.raw("to_char(e.entry_date, 'YYYY-MM-DD') as entry_date"), k.raw("to_char(e.paid_on, 'YYYY-MM-DD') as paid_on"),
    k.raw('e.basic_salary::float8 as basic_salary'), k.raw('e.allowance_amount::float8 as allowance_amount'), k.raw('e.deduction::float8 as deduction'));

const withNet = (e) => ({ ...e, net: Math.round((e.basic_salary + e.allowance_amount - e.deduction) * 100) / 100 });

async function getEntry(k, id) {
  const e = await entryQuery(k).where('e.id', id).first();
  return e ? withNet(e) : null;
}

// Entries for a month (blank = all time), newest first, optionally narrowed.
export async function listEntries({ month, agentId, typeId, status }) {
  if (month && !MONTH_RE.test(month)) throw new SalaryError(400, 'Month must look like 2026-11.');
  if (status && !['pending', 'paid'].includes(status)) throw new SalaryError(400, 'Status must be pending or paid.');
  const q = entryQuery(db);
  if (month) {
    const [y, m] = month.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    q.where('e.entry_date', '>=', `${month}-01`).where('e.entry_date', '<', next);
  }
  if (agentId) q.where('e.agent_id', agentId);
  if (typeId) q.where('e.allowance_type_id', typeId);
  if (status) q.where('e.status', status);
  const [entries, types] = await Promise.all([
    q.orderBy([{ column: 'e.entry_date', order: 'asc' }, { column: 'e.created_at', order: 'asc' }]).limit(1000),
    listTypes()
  ]);
  return { entries: entries.map(withNet), types };
}

async function requireAgent(agentId) {
  const agent = agentId ? await db('users').where({ id: agentId, is_active: true }).first('id', 'name') : null;
  if (!agent) throw new SalaryError(400, 'Choose the employee.');
  return agent;
}

async function requireType(typeId) {
  if (!typeId) return null;
  const t = await db('salary_types').where({ id: typeId, is_active: true, kind: 'allowance' }).first('id', 'name');
  if (!t) throw new SalaryError(400, 'That allowance type no longer exists. Choose another.');
  return t;
}

export async function createEntry(input, actorId) {
  const agent = await requireAgent(input.agent_id);
  const type = await requireType(input.allowance_type_id);
  const row = {
    entry_date: validDate(input.entry_date || today()),
    agent_id: agent.id,
    basic_salary: money(input.basic_salary, 'Basic salary'),
    allowance_type_id: type ? type.id : null,
    allowance_amount: money(input.allowance_amount, 'Allowance'),
    deduction: money(input.deduction, 'Deduction'),
    note: typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null,
    created_by: actorId
  };
  if (row.allowance_amount > 0 && !type) throw new SalaryError(400, 'Choose the allowance type for that amount.');
  const [created] = await db('salary_entries').insert(row).returning('id');
  const id = created.id ?? created;
  await db('audit_logs').insert({
    actor_id: actorId, action_type: 'SALARY_ENTRY_ADDED',
    description: `Salary entry for ${agent.name} on ${row.entry_date}: basic ${fmt(row.basic_salary)}, ${type ? type.name : 'no allowance'} ${fmt(row.allowance_amount)}, deduction ${fmt(row.deduction)}.`
  });
  return getEntry(db, id);
}

// Changes some of a row's fields. A paid row is locked until Paid is undone.
export async function updateEntry(id, patch, actorId) {
  return db.transaction(async (trx) => {
    const cur = await trx('salary_entries').where({ id }).first().forUpdate();
    if (!cur) throw new SalaryError(404, 'That row was not found.');
    if (cur.status === 'paid') throw new SalaryError(409, 'This row is marked Paid. Press "Undo" on it before changing it.');

    const updates = {};
    const changes = [];
    for (const key of EDITABLE) {
      if (!(key in patch)) continue;
      let value = patch[key];
      if (key === 'entry_date') value = validDate(value);
      else if (key === 'agent_id') value = (await requireAgent(value)).id;
      else if (key === 'allowance_type_id') value = value ? (await requireType(value)).id : null;
      else if (key === 'note') value = typeof value === 'string' && value.trim() ? value.trim() : null;
      else value = money(value, key === 'basic_salary' ? 'Basic salary' : key === 'deduction' ? 'Deduction' : 'Allowance');
      const before = MONEY_FIELDS.includes(key) ? Number(cur[key]) : cur[key];
      const same = key === 'entry_date' ? new Date(before).toLocaleDateString('sv-SE') === value : before === value || (before == null && value == null);
      if (!same) { updates[key] = value; changes.push(`${key}: ${before ?? '-'} -> ${value ?? '-'}`); }
    }
    if (!changes.length) return getEntry(trx, id);

    const merged = { ...cur, ...updates };
    if (Number(merged.allowance_amount) > 0 && !merged.allowance_type_id) throw new SalaryError(400, 'Choose the allowance type for that amount.');
    updates.updated_at = trx.fn.now();
    await trx('salary_entries').where({ id }).update(updates);
    await trx('audit_logs').insert({ actor_id: actorId, action_type: 'SALARY_ENTRY_EDITED', description: `Salary entry ${id} changed: ${changes.join(', ')}.` });
    return getEntry(trx, id);
  });
}

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
      description: paid ? `Marked ${cur.agent_name}'s ${cur.entry_date} salary entry (net ${fmt(cur.net)}) as paid.` : `Undid Paid on ${cur.agent_name}'s ${cur.entry_date} salary entry.`
    });
    return getEntry(trx, id);
  });
}

export async function deleteEntry(id, actorId) {
  const cur = await getEntry(db, id);
  if (!cur) throw new SalaryError(404, 'That row was not found.');
  if (cur.status === 'paid') throw new SalaryError(409, 'This row is marked Paid. Press "Undo" on it before deleting.');
  await db('salary_entries').where({ id }).delete();
  await db('audit_logs').insert({
    actor_id: actorId, action_type: 'SALARY_ENTRY_DELETED',
    description: `Deleted ${cur.agent_name}'s ${cur.entry_date} salary entry (net ${fmt(cur.net)}).`
  });
}
