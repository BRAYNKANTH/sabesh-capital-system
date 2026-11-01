-- Salary portal: tables and the starting allowance types. Same as the matching
-- step in scripts/migrate.js, for running in the Neon SQL Editor of the
-- SABESH CAPITAL project. Safe to run more than once.
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

INSERT INTO salary_types (name, sort_order)
SELECT v.name, v.sort_order FROM (VALUES
  ('Vehicle Allowance', 0), ('Petrol Allowance', 1), ('Bonus Allowance', 2), ('Additional Allowance', 3)
) AS v(name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM salary_types t WHERE lower(t.name) = lower(v.name));

CREATE TABLE IF NOT EXISTS salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type_id uuid NOT NULL REFERENCES salary_types(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL,
  paid_on date NOT NULL,
  notes text,
  paid_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salary_payments_agent_id_idx ON salary_payments (agent_id);
CREATE INDEX IF NOT EXISTS salary_payments_paid_on_idx ON salary_payments (paid_on);
