-- Remove the 9 repeated loans from Sabesh Capital (run in the Neon SQL Editor of the SABESH project).
--
-- Delete: SC-001 SC-003 SC-004 SC-005 SC-008 SC-009 SC-010 SC-011 SC-020
-- Keep:   SC-002 (Eugene: has the payment) SC-006 (Diyularani: has the payment) SC-007 (Thayeepan) SC-019 (Piratheepan)
-- SC-003's guarantor is moved onto SC-002 first.
--
-- It checks everything first and stops with a message if anything is unexpected
-- (wrong loan count, or a payment on a loan that would be deleted). The loans, their
-- ledger entries and interest accrual rows are copied into backup_repeated_loans* tables BEFORE they are
-- deleted, and it all happens in one transaction: it completes fully or not at all.
-- If you ever see an error, run  ROLLBACK;  and tell me the message.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM loans WHERE reference_number IN ('SC-001','SC-003','SC-004','SC-005','SC-008','SC-009','SC-010','SC-011','SC-020');
  IF n <> 9 THEN RAISE EXCEPTION 'Expected 9 loans to delete but found %. Nothing was changed.', n; END IF;

  SELECT count(*) INTO n FROM loans WHERE reference_number IN ('SC-002','SC-006','SC-007','SC-019');
  IF n <> 4 THEN RAISE EXCEPTION 'Expected 4 loans to keep but found %. Nothing was changed.', n; END IF;

  IF EXISTS (SELECT 1 FROM transactions t JOIN loans l ON l.id = t.loan_id
             WHERE l.reference_number IN ('SC-001','SC-003','SC-004','SC-005','SC-008','SC-009','SC-010','SC-011','SC-020')) THEN
    RAISE EXCEPTION 'A loan to be deleted has a payment recorded. Nothing was changed.';
  END IF;
  -- Interest accrual rows are posted automatically by the nightly job, so a repeated loan can
  -- have some by now. They are not payments; they are backed up below and deleted with the loan.
  IF EXISTS (SELECT 1 FROM daily_collections d JOIN loans l ON l.id = d.loan_id
             WHERE l.reference_number IN ('SC-001','SC-003','SC-004','SC-005','SC-008','SC-009','SC-010','SC-011','SC-020')) THEN
    RAISE EXCEPTION 'A loan to be deleted has daily collection rows. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM guarantors g JOIN loans l ON l.id = g.loan_id WHERE l.reference_number = 'SC-002') THEN
    RAISE EXCEPTION 'SC-002 already has a guarantor. Nothing was changed.';
  END IF;
END $$;

-- Backup, kept inside the database after the delete.
CREATE TABLE backup_repeated_loans AS
  SELECT * FROM loans WHERE reference_number IN ('SC-001','SC-003','SC-004','SC-005','SC-008','SC-009','SC-010','SC-011','SC-020');
CREATE TABLE backup_repeated_loans_ledger AS
  SELECT * FROM ledger_entries WHERE loan_id IN (SELECT id FROM backup_repeated_loans);
CREATE TABLE backup_repeated_loans_guarantors AS
  SELECT * FROM guarantors WHERE loan_id IN (SELECT id FROM backup_repeated_loans);
CREATE TABLE backup_repeated_loans_accruals AS
  SELECT * FROM interest_accruals WHERE loan_id IN (SELECT id FROM backup_repeated_loans);

-- SC-003's guarantor goes to the loan we keep.
UPDATE guarantors
SET loan_id = (SELECT id FROM loans WHERE reference_number = 'SC-002')
WHERE loan_id = (SELECT id FROM loans WHERE reference_number = 'SC-003');

-- Remove the loans' ledger entries (the money counted as given out twice), then the loans.
DELETE FROM interest_accruals WHERE loan_id IN (SELECT id FROM backup_repeated_loans);
DELETE FROM ledger_entries WHERE loan_id IN (SELECT id FROM backup_repeated_loans);
DELETE FROM loans WHERE id IN (SELECT id FROM backup_repeated_loans);

INSERT INTO audit_logs (actor_id, action_type, description)
VALUES (NULL, 'DELETE_REPEATED_LOANS',
  'Removed 9 repeated loans (SC-001, SC-003, SC-004, SC-005, SC-008, SC-009, SC-010, SC-011, SC-020); kept SC-002, SC-006, SC-007, SC-019. SC-003 guarantor moved to SC-002. Copies kept in backup_repeated_loans*.');

COMMIT;

-- Check: 11 loans left, the ledger still balances (both totals equal), and the backup has 9 loans.
SELECT (SELECT count(*) FROM loans) AS loans_now,
       (SELECT count(*) FROM backup_repeated_loans) AS loans_backed_up,
       (SELECT round(sum(amount), 2) FROM ledger_entries WHERE type = 'debit')  AS total_debits,
       (SELECT round(sum(amount), 2) FROM ledger_entries WHERE type = 'credit') AS total_credits;
