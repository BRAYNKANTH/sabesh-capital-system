-- Partial chit payments: a member can pay a round in several instalments.
-- Each instalment is a row in ticket_payment_entries (a reversal is a negative row);
-- ticket_payments.amount stays the running total and is_paid is true only once the
-- total reaches the round's amount due.
-- Same as the matching step in scripts/migrate.js, for running in the Neon SQL Editor
-- of the SABESH CAPITAL project. Safe to run more than once.
-- Run this BEFORE deploying the new code.

CREATE TABLE IF NOT EXISTS ticket_payment_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES ticket_payments(id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL,
  collected_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_payment_entries_payment_id_idx ON ticket_payment_entries (payment_id);

-- Money already collected becomes one instalment each, keeping the collector and time.
INSERT INTO ticket_payment_entries (payment_id, amount, collected_by, created_at)
SELECT p.id, p.amount, p.collected_by, COALESCE(p.payment_date, NOW())
FROM ticket_payments p
WHERE p.amount > 0
  AND NOT EXISTS (SELECT 1 FROM ticket_payment_entries e WHERE e.payment_id = p.id);

-- Money taken before a round's auction was run is not "paid" until the auction fixes
-- the amount due; running the auction then works out whether it covers it.
UPDATE ticket_payments SET is_paid = false WHERE auction_id IS NULL AND is_paid = true;
