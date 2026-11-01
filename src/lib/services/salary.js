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
  return db('salary_types').where({ is_active: true }).orderBy([{ column: 'sort_order' }, { column: 'created_at' }]).select('id', 'name');
}

export async function createType(name, actorId) {
  const clean = tidyName(name);
  if (!clean) throw new SalaryError(400, 'Type a name for the new salary type.');
  if (clean.length > 80) throw new SalaryError(400, 'The name is too long (80 characters at most).');
  const existing = await db('salary_types').whereRaw('lower(name) = lower(?)', [clean]).first();
  if (existing) {
    if (!existing.is_active) await db('salary_types').where({ id: existing.id }).update({ is_active: true });
    return { id: existing.id, name: existing.name };
  }
  const [{ max }] = await db('salary_types').max('sort_order as max');
  const [row] = await db('salary_types').insert({ name: clean, sort_order: (max ?? -1) + 1 }).returning(['id', 'name']);
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

  const notes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : null;
  const [row] = await db('salary_payments').insert({
    agent_id: agent.id, type_id: type.id, amount, paid_on: paidOn, notes, paid_by: actorId
  }).returning('id');
  await db('audit_logs').insert({
    actor_id: actorId, action_type: 'SALARY_PAID',
    description: `Gave ${amount.toFixed(2)} (${type.name}) to ${agent.name} on ${paidOn}.`
  });
  return { id: row.id ?? row, type_id: type.id, type_name: type.name };
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

// Records for one month (all time when month is blank) plus totals by type and
// by agent, optionally for a single agent.
export async function listPayments({ month, agentId }) {
  if (month && !MONTH_RE.test(month)) throw new SalaryError(400, 'Month must look like 2026-11.');
  const scope = (q) => {
    if (month) {
      const [y, m] = month.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      q.where('sp.paid_on', '>=', `${month}-01`).where('sp.paid_on', '<', next);
    }
    if (agentId) q.where('sp.agent_id', agentId);
    return q;
  };
  const base = () => scope(db('salary_payments as sp').join('users as u', 'u.id', 'sp.agent_id').join('salary_types as t', 't.id', 'sp.type_id'));

  const [payments, byType, byAgent] = await Promise.all([
    base().select('sp.id', 'sp.amount', db.raw("to_char(sp.paid_on, 'YYYY-MM-DD') as paid_on"), 'sp.notes', 'sp.agent_id', 'u.name as agent_name', 'sp.type_id', 't.name as type_name')
      .orderBy([{ column: 'sp.paid_on', order: 'desc' }, { column: 'sp.created_at', order: 'desc' }]).limit(500),
    base().groupBy('t.id', 't.name', 't.sort_order').orderBy('t.sort_order').select('t.id as type_id', 't.name as type_name').sum('sp.amount as total'),
    base().groupBy('u.id', 'u.name').orderBy('u.name').select('u.id as agent_id', 'u.name as agent_name').sum('sp.amount as total')
  ]);
  const total = byType.reduce((s, r) => s + Number(r.total), 0);
  return { payments, byType, byAgent, total };
}
