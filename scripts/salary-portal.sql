-- Salary portal: the monthly table (one row per agent per month) and the
-- starting columns. Same as the matching step in scripts/migrate.js, for
-- running in the Neon SQL Editor of the SABESH CAPITAL project.
-- Safe to run more than once.
-- After running it, turn on "Salary Portal Access" for the admin in Admin Tools.

ALTER TABLE users ADD COLUMN IF NOT EXISTS salary_access boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS salary_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS salary_types_name_lower_idx ON salary_types (lower(name));

-- Column kinds: 'salary' (basic salary), 'allowance' (added to pay), 'deduction'
-- (taken off: advances, loan repayments...). Types the admin adds are allowances
-- or deductions.
ALTER TABLE salary_types ADD COLUMN IF NOT EXISTS kind varchar(10) NOT NULL DEFAULT 'allowance';

INSERT INTO salary_types (name, kind, sort_order)
SELECT v.name, v.kind, v.sort_order FROM (VALUES
  ('Basic Salary', 'salary', -1), ('Vehicle Allowance', 'allowance', 0), ('Petrol Allowance', 'allowance', 1),
  ('Bonus Allowance', 'allowance', 2), ('Additional Allowance', 'allowance', 3), ('Advance', 'deduction', 4)
) AS v(name, kind, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM salary_types t WHERE lower(t.name) = lower(v.name));

-- status 'pending' until the admin presses Paid (then the row is locked).
CREATE TABLE IF NOT EXISTS salary_sheet_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  month varchar(7) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'pending',
  paid_on date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (agent_id, month)
);
CREATE INDEX IF NOT EXISTS salary_sheet_rows_month_idx ON salary_sheet_rows (month);

CREATE TABLE IF NOT EXISTS salary_sheet_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id uuid NOT NULL REFERENCES salary_sheet_rows(id) ON DELETE CASCADE,
  type_id uuid NOT NULL REFERENCES salary_types(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL,
  UNIQUE (row_id, type_id)
);
