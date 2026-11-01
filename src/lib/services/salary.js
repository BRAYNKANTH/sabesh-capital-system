import db from '../db.js';

export class SalaryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const tidyName = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

export async function listTypes() {
  return db('salary_types').where({ is_active: true }).orderBy([{ column: 'sort_order' }, { column: 'created_at' }]).select('id', 'name', 'kind');
}

export async function createType(name, actorId) {
  const clean = tidyName(name);
  if (!clean) throw new SalaryError(400, 'Type a name for the new salary type.');
  if (clean.length > 80) throw new SalaryError(400, 'The name is too long (80 characters at most).');
  const existing = await db('salary_types').whereRaw('lower(name) = lower(?)', [clean]).first();
  if (existing) {
    if (!existing.is_active) await db('salary_types').where({ id: existing.id }).update({ is_active: true });
    return { id: existing.id, name: existing.name, kind: existing.kind };
  }
  const [{ max }] = await db('salary_types').max('sort_order as max');
  const [row] = await db('salary_types').insert({ name: clean, sort_order: (max ?? -1) + 1 }).returning(['id', 'name', 'kind']);
  await db('audit_logs').insert({ actor_id: actorId, action_type: 'SALARY_TYPE_CREATED', description: `Added salary type '${clean}'.` });
  return row;
}

export async function recordPayment(input, actorId) {
  const amount = parseFloat(input.amount);
  if (!(amount > 0) || amount >= 1e12) throw new SalaryError(400, 'Enter an amount greater than zero.');
  const paidOn = input.paid_on || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
  if (!DATE_RE.test(paidOn) || Number.isNaN(Date.parse(paidOn))) throw new SalaryError(400, 'Pick a valid date.');

  const agent = input.agent_id
    ? await db('users').where({ id: input.agent_id, is_active: true }).whereIn('role', ['agent', 'admin']).first('id', 'name')
    : null;
  if (!agent) throw new SalaryError(400, 'Choose who the money was given to.');

  let type;
  if (input.type_id) {
    type = await db('salary_types').where({ id: input.type_id, is_active: true }).first();
    if (!type) throw new SalaryError(400, 'That salary type no longer exists. Choose another.');
  } else if (input.new_type_name) {
    type = await createType(input.new_type_name, actorId);
  } else {
    throw new SalaryError(400, 'Choose a salary type, or add a new one.');
  }

  // pending = the agent paid out of their own pocket and is owed it; settled later with markPaid.
  const pending = input.status === 'pending';
  const notes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : null;
  const [row] = await db('salary_payments').insert({
    agent_id: agent.id, type_id: type.id, amount, paid_on: paidOn, notes, paid_by: actorId,
    status: pending ? 'pending' : 'paid', settled_on: pending ? null : paidOn
  }).returning('id');
  await db('audit_logs').insert({
    actor_id: actorId, action_type: 'SALARY_PAID',
    description: pending
      ? `Noted ${amount.toFixed(2)} (${type.name}) spent by ${agent.name} on ${paidOn}, to be paid back.`
      : `Gave ${amount.toFixed(2)} (${type.name}) to ${agent.name} on ${paidOn}.`
  });
  return { id: row.id ?? row, type_id: type.id, type_name: type.name, pending };
}

export async function deletePayment(id, actorId) {
  const p = await db('salary_payments as sp').join('users as u', 'u.id', 'sp.agent_id').join('salary_types as t', 't.id', 'sp.type_id')
    .where('sp.id', id).first('sp.amount', 'u.name as agent_name', 't.name as type_name');
  if (!p) throw new SalaryError(404, 'That record was not found.');
  await db('salary_payments').where({ id }).delete();
  await db('audit_logs').insert({
    actor_id: actorId, action_type: 'SALARY_DELETED',
    description: `Deleted salary record: ${Number(p.amount).toFixed(2)} (${p.type_name}) for ${p.agent_name}.`
  });
}

// Settles a pending record: the money has now been handed to the agent.
export async function markPaid(id, actorId) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
  // Only a pending row flips, so a double tap can't log it twice.
  const updated = await db('salary_payments').where({ id, status: 'pending' }).update({ status: 'paid', settled_on: today });
  if (!updated) {
    const exists = await db('salary_payments').where({ id }).first('status');
    if (!exists) throw new SalaryError(404, 'That record was not found.');
    return { alreadyPaid: true };
  }
  const p = await db('salary_payments as sp').join('users as u', 'u.id', 'sp.agent_id').join('salary_types as t', 't.id', 'sp.type_id')
    .where('sp.id', id).first('sp.amount', 'u.name as agent_name', 't.name as type_name');
  await db('audit_logs').insert({
    actor_id: actorId, action_type: 'SALARY_SETTLED',
    description: `Paid back ${Number(p.amount).toFixed(2)} (${p.type_name}) to ${p.agent_name}.`
  });
  return { alreadyPaid: false };
}

// Records (newest first) plus `rows`: totals grouped by agent, type and status,
// which the portal turns into every per-agent / per-type / owed figure.
// Filters: month (blank = all time), agent, type, status, kind (salary | allowance).
export async function listPayments({ month, agentId, typeId, status, kind }) {
  if (month && !MONTH_RE.test(month)) throw new SalaryError(400, 'Month must look like 2026-11.');
  if (status && !['pending', 'paid'].includes(status)) throw new SalaryError(400, 'Status must be pending or paid.');
  if (kind && !['salary', 'allowance'].includes(kind)) throw new SalaryError(400, 'Kind must be salary or allowance.');
  const scope = (q) => {
    if (typeId) q.where('sp.type_id', typeId);
    if (status) q.where('sp.status', status);
    if (kind) q.where('t.kind', kind);
    if (month) {
      const [y, m] = month.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      q.where('sp.paid_on', '>=', `${month}-01`).where('sp.paid_on', '<', next);
    }
    if (agentId) q.where('sp.agent_id', agentId);
    return q;
  };
  const base = () => scope(db('salary_payments as sp').join('users as u', 'u.id', 'sp.agent_id').join('salary_types as t', 't.id', 'sp.type_id'));

  const [payments, rows] = await Promise.all([
    base().select('sp.id', 'sp.amount', 'sp.status', 'sp.notes', 'sp.agent_id', 'u.name as agent_name', 'sp.type_id', 't.name as type_name', 't.kind',
      db.raw("to_char(sp.paid_on, 'YYYY-MM-DD') as paid_on"), db.raw("to_char(sp.settled_on, 'YYYY-MM-DD') as settled_on"))
      .orderBy([{ column: 'sp.paid_on', order: 'desc' }, { column: 'sp.created_at', order: 'desc' }]).limit(500),
    base().groupBy('u.id', 'u.name', 't.id', 't.name', 't.kind', 't.sort_order', 'sp.status').orderBy(['u.name', 't.sort_order'])
      .select('u.id as agent_id', 'u.name as agent_name', 't.id as type_id', 't.name as type_name', 't.kind', 'sp.status').sum('sp.amount as total')
  ]);
  return { payments, rows };
}
