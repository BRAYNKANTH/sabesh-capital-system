-- Winner payouts: records when the host has paid a round's pot to its winner
-- (how much, when and by whom). Same as the matching step in scripts/migrate.js,
-- for running in the Neon SQL Editor of the SABESH CAPITAL project.
-- Safe to run more than once. Until it has been run, "Mark payout paid" shows a
-- message asking for it; everything else keeps working.

ALTER TABLE ticket_auctions ADD COLUMN IF NOT EXISTS payout_paid_amount numeric(15,2);
ALTER TABLE ticket_auctions ADD COLUMN IF NOT EXISTS payout_paid_at timestamptz;
ALTER TABLE ticket_auctions ADD COLUMN IF NOT EXISTS payout_paid_by uuid REFERENCES users(id) ON DELETE SET NULL;
