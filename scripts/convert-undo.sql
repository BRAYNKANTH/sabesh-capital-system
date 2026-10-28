-- UNDO the conversion. Restores every converted loan and removes the ledger adjustments. Refuses if payments were recorded since.
-- Run in the Neon SQL Editor of the SABESH CAPITAL project. Paste this file ONLY, run it, read the result.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM transactions t JOIN loan_daily_conversion_snapshot s ON s.id = t.loan_id WHERE t.created_at > s.converted_at) THEN
    RAISE EXCEPTION 'A payment was recorded on a converted loan after the conversion, so it cannot be undone automatically. Tell Claude.';
  END IF;
END $$;


UPDATE loans l SET
  interest_type = s.interest_type, duration_periods = s.duration_periods,
  is_flat_installment = s.is_flat_installment, daily_installment_amount = s.daily_installment_amount,
  principal_per_day = s.principal_per_day, interest_per_day = s.interest_per_day,
  principal_outstanding = s.principal_outstanding, interest_balance = s.interest_balance,
  status = s.status, last_accrual_date = s.last_accrual_date, next_accrual_date = s.next_accrual_date,
  maturity_date = s.maturity_date, updated_at = now()
FROM loan_daily_conversion_snapshot s WHERE l.id = s.id;
DELETE FROM ledger_entries WHERE id IN (SELECT id FROM loan_daily_conversion_ledger);
DROP TABLE loan_daily_conversion_ledger;
DROP TABLE loan_daily_conversion_snapshot;
COMMIT;
