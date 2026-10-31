// Who may win a round. Each member wins exactly once across the group's life,
// and on the final round the one member who has not won yet is the winner.

// requestedId   - the member chosen for this round, if any
// members       - everyone on the roster: [{ id, name }]
// wonByMember   - Map of member id -> the round they already won
// isFinalRound  - this is the last round of the group
// memberCount   - how many members the group is meant to have (one per round)
//
// Returns { winnerId, auto? } or { error }. winnerId is null when no winner is
// chosen yet (it can be assigned later from the round history).
export function resolveWinner({ requestedId, members, wonByMember, isFinalRound, memberCount }) {
  if (requestedId) {
    const member = members.find((m) => m.id === requestedId);
    if (!member) return { error: 'Winner member not found in this ticket group.' };
    if (wonByMember.has(requestedId)) {
      return { error: `${member.name} has already won round ${wonByMember.get(requestedId)}. Each member can win only once.` };
    }
    return { winnerId: requestedId };
  }

  // Last round, nobody chosen: if the roster is complete and exactly one member
  // has not won, that member wins by default.
  if (isFinalRound && members.length === memberCount) {
    const remaining = members.filter((m) => !wonByMember.has(m.id));
    if (remaining.length === 1) return { winnerId: remaining[0].id, auto: true };
  }
  return { winnerId: null };
}
