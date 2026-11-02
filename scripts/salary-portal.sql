-- Salary portal: the salary table (one row per entry) and the starting
-- allowance types. Same as the matching step in scripts/migrate.js, for
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

-- The allowance types offered in the table's Allowances dropdown. Only kind
-- 'allowance' is listed; the admin can add more from the dropdown itself.
ALTER TABLE salary_types ADD COLUMN IF NOT EXISTS kind varchar(10) NOT NULL DEFAULT 'allowance';

INSERT INTO salary_types (name, kind, sort_order)
SELECT v.name, 'allowance', v.sort_order FROM (VALUES
  ('Vehicle Allowance', 0), ('Petrol Allowance', 1), ('Bonus Allowance', 2), ('Additional Allowance', 3)
) AS v(name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM salary_types t WHERE lower(t.name) = lower(v.name));

-- One row per entry. Net = basic + allowance - deduction. 'pending' until the
-- admin presses Paid, which locks the row.
CREATE TABLE IF NOT EXISTS salary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  agent_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  basic_salary numeric(15,2) NOT NULL DEFAULT 0,
  allowance_type_id uuid REFERENCES salary_types(id) ON DELETE RESTRICT,
  allowance_amount numeric(15,2) NOT NULL DEFAULT 0,
  deduction numeric(15,2) NOT NULL DEFAULT 0,
  status varchar(10) NOT NULL DEFAULT 'pending',
  paid_on date,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salary_entries_entry_date_idx ON salary_entries (entry_date);
CREATE INDEX IF NOT EXISTS salary_entries_agent_id_idx ON salary_entries (agent_id);
