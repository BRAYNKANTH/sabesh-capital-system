import db from '../db.js';

export class SalaryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const KINDS = ['allowance', 'deduction'];

const tidyName = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });

function assertMonth(month) {
  if (!MONTH_RE.test(month || '')) throw new SalaryError(400, 'Month must look like 2026-11.');
}

export async function listTypes() {
  return db('salary_types').where({ is_active: true }).orderBy([{ column: 'sort_order' }, { column: 'created_at' }]).select('id', 'name', 'kind');
}

// Adds a column to the table. A name that already exists (any case) is reused.
export async function createType(name, kind, actorId) {
  const clean = tidyName(name);
  if (!clean) throw new SalaryError(400, 'Type a name for the new column.');
  if (clean.length > 80) throw new SalaryError(400, 'The name is too long (80 characters at most).');
  const k = kind || 'allowance';
  if (!KINDS.includes(k)) throw new SalaryError(400, 'Choose allowance or deduction.');
  const existing = await db('salary_types').whereRaw('lower(name) = lower(?)', [clean]).first();
  if (existing) {
    if (!existing.is_active) await db('salary_types').where({ id: existing.id }).update({ is_active: true });
    return { id: existing.id, name: existing.name, kind: existing.kind };
  }
  const [{ max }] = await db('salary_types').max('sort_order as max');
  const [row] = await db('salary_types').insert({ name: clean, kind: k, sort_order: (max ?? -1) + 1 }).returning(['id', 'name', 'kind']);
  await db('audit_logs').insert({ actor_id: actorId, action_type: 'SALARY_TYPE_CREATED', description: `Added salary column '${clean}' (${k}).` });
  return row;
}

function shapeRow(row, agentName, items) {
  return {
    agent_id: row ? row.agent_id : null,
    agent_name: agentName,
    status: row ? row.status : 'pending',
    paid_on: row?.paid_on || null,
    items: Object.fromEntries(items.map((i) => [i.type_id, Number(i.amount)]))
  };
}

// The table for one month: every active agent plus anyone who already has a row.
export async function getSheet(month) {
  assertMonth(month);
  const [types, rows, agents] = await Promise.all([
    listTypes(),
    db('salary_sheet_rows').where({ month }).select('id', 'agent_id', 'status', db.raw("to_char(paid_on, 'YYYY-MM-DD') as paid_on")),
    db('users').where({ is_active: true, role: 'agent' }).select('id', 'name')
  ]);
  const items = rows.length ? await db('salary_sheet_items').whereIn('row_id', rows.map((r) => r.id)).select('row_id', 'type_id', 'amount') : [];
  const rowByAgent = new Map(rows.map((r) => [r.agent_id, r]));
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const missing = rows.map((r) => r.agent_id).filter((id) => !names.has(id));
  if (missing.length) (await db('users').whereIn('id', missing).select('id', 'name')).forEach((u) => names.set(u.id, u.name));

  const list = [...names.entries()].map(([agentId, name]) => {
    const row = rowByAgent.get(agentId);
    const shaped = shapeRow(row, name, row ? items.filter((i) => i.row_id === row.id) : []);
    return { ...shaped, agent_id: agentId };
  }).sort((a, b) => a.agent_name.localeCompare(b.agent_name));
  return { month, types, rows: list };
}

async function rowView(trx, agentId, month) {
  const row = await trx('salary_sheet_rows').where({ agent_id: agentId, month }).first('id', 'agent_id', 'status', trx.raw("to_char(paid_on, 'YYYY-MM-DD') as paid_on"));
  const agent = await trx('users').where({ id: agentId }).first('name');
  const items = row ? await trx('salary_sheet_items').where({ row_id: row.id }).select('type_id', 'amount') : [];
  return { ...shapeRow(row, agent.name, items), agent_id: agentId };
}

// Sets one cell (agent + month + column). A blank or zero amount clears it.
export async function setCell({ agentId, month, typeId, amount }, actorId) {
  assertMonth(month);
  const value = amount === '' || amount === null || amount === undefined ? 0 : parseFloat(amount);
  if (Number.isNaN(value) || value < 0 || value >= 1e12) throw new SalaryError(400, 'Enter an amount of zero or more.');
  const agent = await db('users').where({ id: agentId, is_active: true }).first('id', 'name');
  if (!agent) throw new SalaryError(400, 'That agent was not found.');
  const type = await db('salary_types').where({ id: typeId, is_active: true }).first('id', 'name');
  if (!type) throw new SalaryError(400, 'That column no longer exists.');

  return db.transaction(async (trx) => {
    await trx('salary_sheet_rows').insert({ agent_id: agentId, month }).onConflict(['agent_id', 'month']).ignore();
    const row = await trx('salary_sheet_rows').where({ agent_id: agentId, month }).first().forUpdate();
    if (row.status === 'paid') throw new SalaryError(409, `${agent.name}'s ${month} row is marked Paid. Press "Undo" on it before changing amounts.`);

    const old = await trx('salary_sheet_items').where({ row_id: row.id, type_id: typeId }).first('amount');
    const before = old ? Number(old.amount) : 0;
    if (value === before) return rowView(trx, agentId, month);

    if (value === 0) {
      await trx('salary_sheet_items').where({ row_id: row.id, type_id: typeId }).delete();
    } else {
      await trx('salary_sheet_items').insert({ row_id: row.id, type_id: typeId, amount: value }).onConflict(['row_id', 'type_id']).merge({ amount: value });
    }
    await trx('salary_sheet_rows').where({ id: row.id }).update({ updated_at: trx.fn.now() });
    await trx('audit_logs').insert({
      actor_id: actorId, action_type: 'SALARY_EDITED',
      description: `${month} ${agent.name} - ${type.name}: ${before.toFixed(2)} -> ${value.toFixed(2)}.`
    });
    return rowView(trx, agentId, month);
  });
}

// Marks a month's row as paid (locks it) or undoes that.
export async function setPaid({ agentId, month, paid }, actorId) {
  assertMonth(month);
  return db.transaction(async (trx) => {
    const row = await trx('salary_sheet_rows').where({ agent_id: agentId, month }).first().forUpdate();
    if (!row) throw new SalaryError(404, 'Nothing is entered for this agent this month.');
    const agent = await trx('users').where({ id: agentId }).first('name');
    const wanted = paid ? 'paid' : 'pending';
    if (row.status !== wanted) {
      if (paid) {
        const [{ count }] = await trx('salary_sheet_items').where({ row_id: row.id }).count('* as count');
        if (!Number(count)) throw new SalaryError(400, 'Enter an amount first.');
      }
      await trx('salary_sheet_rows').where({ id: row.id }).update({ status: wanted, paid_on: paid ? today() : null, updated_at: trx.fn.now() });
      await trx('audit_logs').insert({
        actor_id: actorId, action_type: paid ? 'SALARY_PAID' : 'SALARY_UNPAID',
        description: paid ? `Marked ${month} salary of ${agent.name} as paid.` : `Undid Paid on ${month} salary of ${agent.name}.`
      });
    }
    return rowView(trx, agentId, month);
  });
}
