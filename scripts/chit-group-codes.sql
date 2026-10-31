-- Chit group codes: a short, unique, editable label (SMC, SMC-2 ...) that tells groups
-- apart when their names are alike. Same as the matching step in scripts/migrate.js,
-- for running in the Neon SQL Editor of the SABESH CAPITAL project.
-- Safe to run more than once: only groups without a code get one.
-- Run this BEFORE (or right after) deploying; the app copes with a group that has no code yet.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS code varchar(12);

-- Existing groups get a code made from their name: the first letters of its words
-- ("Sabesh micro credit" -> SMC), or the first three letters of a single word;
-- SMC-2, SMC-3 ... when that is already used.
DO $$
DECLARE
  r record;
  words text[];
  base text;
  candidate text;
  n int;
BEGIN
  FOR r IN SELECT id, name FROM tickets WHERE code IS NULL ORDER BY created_at, id LOOP
    SELECT array_agg(s.w ORDER BY s.i) INTO words
    FROM (
      SELECT regexp_replace(t.w0, '[^A-Za-z0-9]', '', 'g') AS w, t.i
      FROM regexp_split_to_table(r.name, '\s+') WITH ORDINALITY AS t(w0, i)
    ) s
    WHERE s.w <> '';

    IF words IS NULL THEN
      base := 'G';
    ELSIF array_length(words, 1) = 1 THEN
      base := upper(left(words[1], 3));
    ELSE
      SELECT upper(string_agg(left(u.x, 1), '' ORDER BY u.i)) INTO base
      FROM unnest(words[1:4]) WITH ORDINALITY AS u(x, i);
    END IF;

    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM tickets WHERE lower(code) = lower(candidate)) LOOP
      n := n + 1;
      candidate := base || '-' || n;
    END LOOP;

    UPDATE tickets SET code = candidate WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tickets_code_unique ON tickets (lower(code));
