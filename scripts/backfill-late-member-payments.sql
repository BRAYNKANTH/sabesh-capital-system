-- Give every chit member who joined after some rounds were run an UNPAID payment row for
-- each of those rounds, so the payment can be ticked and the thank-you SMS goes out.
-- Safe to run more than once: it only adds rows that are missing and never changes existing ones.
-- Run in the Neon SQL Editor of the SABESH CAPITAL project.

INSERT INTO ticket_payments (auction_id, ticket_id, member_id, round_number, is_paid)
SELECT a.id, a.ticket_id, m.id, a.round_number, false
FROM ticket_auctions a
JOIN ticket_members m ON m.ticket_id = a.ticket_id
WHERE NOT EXISTS (
  SELECT 1 FROM ticket_payments p
  WHERE p.ticket_id = a.ticket_id AND p.member_id = m.id AND p.round_number = a.round_number
);

-- How many missing rows were added in total is shown by the "INSERT 0 N" message.
