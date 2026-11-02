-- Cheque loans: cheque number, bank and the "2 days before" reminder flag.
-- Same as the matching step in scripts/migrate.js, for running in the Neon SQL
-- Editor of the SABESH CAPITAL project. Safe to run more than once.
-- Run it BEFORE issuing the first cheque loan. Until it has been run, issuing a
-- cheque loan fails with a server error; everything else keeps working.
-- (The cheque's last date is stored in the loan's existing maturity_date.)

ALTER TABLE loans ADD COLUMN IF NOT EXISTS cheque_number varchar(50);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS cheque_bank varchar(100);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS cheque_reminder_sent_at timestamptz;
