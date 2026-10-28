-- STEP 2 of 2: APPLY the conversion. Run only after reading the step 1 result and taking a backup. Runs once.
-- Run in the Neon SQL Editor of the SABESH CAPITAL project. Paste this file ONLY, run it, read the result.

BEGIN;

-- Snapshot = the "before" values and the new values, kept for the undo below.
CREATE TABLE loan_daily_conversion_snapshot AS
  SELECT *, now() AS converted_at FROM loan_daily_conversion_plan WHERE mode IN ('open_ended', 'fixed_term');

CREATE TABLE loan_daily_conversion_ledger (id uuid PRIMARY KEY);

UPDATE loans l SET
  interest_type = 'daily',
  duration_periods = s.new_duration_periods,
  is_flat_installment = (s.mode = 'fixed_term'),
  daily_installment_amount = s.new_daily_installment_amount,
  principal_per_day = s.new_principal_per_day,
  interest_per_day = s.new_interest_per_day,
  principal_outstanding = s.new_principal_outstanding,
  interest_balance = s.new_interest_balance,
  status = s.new_status,
  last_accrual_date = CASE WHEN s.mode = 'open_ended' THEN now() ELSE l.last_accrual_date END,
  next_accrual_date = s.new_next_accrual_date,
  maturity_date = s.new_maturity_date,
  updated_at = now()
FROM loan_daily_conversion_snapshot s
WHERE l.id = s.id;

-- Ledger: move the receivable accounts to the new balances; the change in the total owed is interest revenue.
WITH d AS (
  SELECT id AS loan_id,
         new_principal_outstanding - round(principal_outstanding, 2) AS dp,
         new_interest_balance - round(interest_balance, 2) AS di
  FROM loan_daily_conversion_snapshot
),
rows AS (
  SELECT loan_id, 'loan_receivable_principal' AS account, dp AS amt FROM d
  UNION ALL SELECT loan_id, 'loan_receivable_interest', di FROM d
  UNION ALL SELECT loan_id, 'interest_revenue', -(dp + di) FROM d
),
ins AS (
  INSERT INTO ledger_entries (loan_id, account, type, amount)
  SELECT loan_id, account, CASE WHEN amt > 0 THEN 'debit' ELSE 'credit' END, abs(amt)
  FROM rows WHERE abs(amt) >= 0.005
  RETURNING id
)
INSERT INTO loan_daily_conversion_ledger SELECT id FROM ins;

INSERT INTO audit_logs (actor_id, action_type, description)
SELECT lender_id, 'CONVERT_LOAN_TO_DAILY',
       format('Loan %s converted from %s to daily. Principal LKR %s -> %s, interest due LKR %s -> %s.',
              reference_number, interest_type, round(principal_outstanding, 2), new_principal_outstanding,
              round(interest_balance, 2), new_interest_balance)
FROM loan_daily_conversion_snapshot;

COMMIT;

-- Check: how many were converted, and the ledger still balances (both numbers must match).
SELECT (SELECT count(*) FROM loan_daily_conversion_snapshot) AS converted_loans,
       (SELECT round(sum(amount), 2) FROM ledger_entries WHERE type = 'debit') AS total_debits,
       (SELECT round(sum(amount), 2) FROM ledger_entries WHERE type = 'credit') AS total_credits;


