import { describe, it, expect } from 'vitest';
import { resolveWinner } from './chitWinner.js';

const members = [{ id: 'a', name: 'Anu' }, { id: 'b', name: 'Bala' }, { id: 'c', name: 'Chitra' }];
const base = { members, wonByMember: new Map(), isFinalRound: false, memberCount: 3 };

describe('resolveWinner', () => {
  it('accepts a member who has not won', () => {
    expect(resolveWinner({ ...base, requestedId: 'b' })).toEqual({ winnerId: 'b' });
  });

  it('refuses a member who already won, naming the round', () => {
    const r = resolveWinner({ ...base, requestedId: 'a', wonByMember: new Map([['a', 2]]) });
    expect(r.winnerId).toBeUndefined();
    expect(r.error).toBe('Anu has already won round 2. Each member can win only once.');
  });

  it('refuses someone who is not on the roster', () => {
    expect(resolveWinner({ ...base, requestedId: 'zzz' }).error).toMatch(/not found/);
  });

  it('leaves the winner open when none is chosen mid-group', () => {
    expect(resolveWinner({ ...base, requestedId: undefined })).toEqual({ winnerId: null });
  });

  it('makes the last remaining member the winner of the final round', () => {
    const r = resolveWinner({ ...base, requestedId: '', isFinalRound: true, wonByMember: new Map([['a', 1], ['b', 2]]) });
    expect(r).toEqual({ winnerId: 'c', auto: true });
  });

  it('does not guess on the final round when the roster is incomplete or several remain', () => {
    const won = new Map([['a', 1]]);
    expect(resolveWinner({ ...base, isFinalRound: true, wonByMember: won })).toEqual({ winnerId: null });
    expect(resolveWinner({ ...base, isFinalRound: true, members: members.slice(0, 2), wonByMember: new Map([['a', 1]]) })).toEqual({ winnerId: null });
  });

  it('still honours an explicit choice on the final round', () => {
    expect(resolveWinner({ ...base, requestedId: 'c', isFinalRound: true, wonByMember: new Map([['a', 1], ['b', 2]]) })).toEqual({ winnerId: 'c' });
  });
});
