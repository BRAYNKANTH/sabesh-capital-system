// A chit group's short code (for example "SMC" or "SMC-2") tells groups apart
// when their names are alike. It is unique across the organisation (ignoring
// case), can be changed at any time, and is shown on cards, collect lines and
// SMS. Pure functions only, so the browser and the server share one rule.

export const CODE_MAX_LENGTH = 12;
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]*$/;

// Tidies what was typed (upper case, spaces become hyphens) and checks it.
// Returns { code } or { error }.
export function normalizeCode(input) {
  const code = String(input ?? '').trim().toUpperCase().replace(/\s+/g, '-');
  if (!code) return { error: 'Enter a short code for the group (for example SMC-1).' };
  if (code.length > CODE_MAX_LENGTH) return { error: `The code can be at most ${CODE_MAX_LENGTH} characters.` };
  if (!CODE_RE.test(code)) return { error: 'The code can only use letters, numbers, hyphens and underscores, and must start with a letter or number.' };
  return { code };
}

// A starting suggestion made from the group's name: the first letters of its
// words ("Sabesh micro credit" -> SMC), or the first three letters of a single
// word. When that is taken it becomes SMC-2, SMC-3 ... `taken` is the set of
// codes already in use (any case).
export function suggestCode(name, taken = []) {
  const used = new Set([...taken].filter(Boolean).map((c) => String(c).toUpperCase()));
  const words = String(name ?? '').split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
  let base;
  if (words.length === 0) base = 'G';
  else if (words.length === 1) base = words[0].slice(0, 3).toUpperCase();
  else base = words.slice(0, 4).map((w) => w[0]).join('').toUpperCase();

  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
}

// Soft light backgrounds with dark text (all above 7:1 contrast), picked from
// the code so a group keeps the same colour everywhere without storing one.
const CHIP_COLORS = [
  { bg: '#dbe7ff', fg: '#1e3a8a' },
  { bg: '#d1fae5', fg: '#065f46' },
  { bg: '#fef3c7', fg: '#78350f' },
  { bg: '#ffe4e6', fg: '#9f1239' },
  { bg: '#ede9fe', fg: '#5b21b6' },
  { bg: '#ccfbf1', fg: '#115e59' },
  { bg: '#ffedd5', fg: '#9a3412' },
  { bg: '#e2e8f0', fg: '#1e293b' }
];

export function chipColors(code) {
  let h = 5381;
  for (const ch of String(code ?? '').toUpperCase()) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
}
