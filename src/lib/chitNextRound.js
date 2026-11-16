// Suggested gap until the next chit round.
// Daily amount = total / cycleDays; days = (total - discount) / daily amount.
// Not rounded: when it is a part-day, staff pick the day before or after.
export function nextRoundDays(total, discount, cycleDays = 30) {
  const t = Number(total);
  const d = Number(discount);
  const c = Number(cycleDays) > 0 ? Number(cycleDays) : 30;
  if (!(t > 0) || !Number.isFinite(d) || d < 0 || d > t) return null;
  const days = ((t - d) / (t / c));
  return Math.round(days * 100) / 100;
}

const addDays = (dateStr, n) => {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};

// { days, earlier, later } where earlier/later are YYYY-MM-DD (same when a whole number).
export function nextRoundSuggestion(auctionDate, total, discount, cycleDays = 30) {
  const days = nextRoundDays(total, discount, cycleDays);
  if (days === null) return null;
  const earlier = addDays(auctionDate, Math.floor(days));
  const later = addDays(auctionDate, Math.ceil(days));
  if (!earlier || !later) return { days, earlier: null, later: null };
  return { days, earlier, later };
}
