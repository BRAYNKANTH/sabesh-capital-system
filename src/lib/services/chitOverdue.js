// A round's payments are due on the day of its auction, with a few days of
// grace; after that an unpaid or part-paid payment is overdue. One place to
// change the grace period.
export const OVERDUE_AFTER_DAYS = 7;

// 'YYYY-MM-DD' from a date column value: a Date (read in local time, as the
// database driver builds it) or a string that starts with the date.
export function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const dayNumber = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

// How many days past its due date a payment for the round auctioned on
// `auctionDate` is on `today` (both dates, as 'YYYY-MM-DD' or Date); 0 when it
// is not overdue yet.
export function overdueDays(auctionDate, today, grace = OVERDUE_AFTER_DAYS) {
  const a = toDateString(auctionDate);
  const t = toDateString(today);
  if (!a || !t) return 0;
  const late = dayNumber(t) - dayNumber(a) - grace;
  return late > 0 ? late : 0;
}
