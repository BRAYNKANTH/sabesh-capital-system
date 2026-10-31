import db from '../db.js';
import { normalizeCode, suggestCode } from './chitCode.js';

// Server side of the group code rules: the code must be unique across all
// groups, ignoring case. Returns { code } or { error }.

async function groupUsing(code, exceptId) {
  const q = db('tickets').whereRaw('lower(code) = lower(?)', [code]);
  if (exceptId) q.whereNot({ id: exceptId });
  return q.select('id', 'name').first();
}

const takenMessage = (code, group) => `The code ${code} is already used by '${group.name}'. Choose a different code.`;

// Postgres "undefined column": the codes migration has not been run yet. Groups
// can still be created (without a code) until it is.
const columnMissing = (error) => error?.code === '42703';

// A new group: the typed code if there is one, else one made from the name.
// Returns { code: null } when the codes migration has not been run yet.
export async function codeForNewGroup(name, typed) {
  try {
    if (typed === undefined || typed === null || String(typed).trim() === '') {
      const taken = (await db('tickets').whereNotNull('code').select('code')).map((r) => r.code);
      return { code: suggestCode(name, taken) };
    }
    const checked = normalizeCode(typed);
    if (checked.error) return checked;
    const clash = await groupUsing(checked.code);
    return clash ? { error: takenMessage(checked.code, clash) } : checked;
  } catch (error) {
    if (columnMissing(error)) return { code: null };
    throw error;
  }
}

// An existing group changing its code.
export async function codeForExistingGroup(typed, groupId) {
  const checked = normalizeCode(typed);
  if (checked.error) return checked;
  const clash = await groupUsing(checked.code, groupId);
  return clash ? { error: takenMessage(checked.code, clash) } : checked;
}

// Two requests can pass the check at the same moment; the unique index then
// rejects the second one.
export const isCodeTaken = (error) => error?.code === '23505' && /tickets_code_unique/.test(error?.constraint || error?.message || '');
