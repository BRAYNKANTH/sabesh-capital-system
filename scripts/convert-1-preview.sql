-- STEP 1 of 2: build the plan and PREVIEW it. Changes no loan.
-- Run in the Neon SQL Editor of the SABESH CAPITAL project. Paste this file ONLY, run it, read the result.

CREATE OR REPLACE VIEW loan_daily_conversion_plan AS
WITH base AS (
  SELECT l.*, u.name AS borrower_name,
    COALESCE((SELECT SUM(a.amount_accrued) FROM interest_accruals a WHERE a.loan_id = l.id), 0) AS old_accrued,
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.loan_id = l.id), 0) AS paid,
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.loan_id = l.id AND t.payment_type = 'interest'), 0) AS interest_paid,
    (now() AT TIME ZONE 'Asia/Colombo')::date AS today_sl,
    (l.created_at AT TIME ZONE 'Asia/Colombo')::date AS created_sl
  FROM loans l
  JOIN users u ON u.id = l.borrower_id
  WHERE l.status = 'active' AND l.interest_type IN ('weekly', 'monthly')
),
calc AS (
  SELECT b.*,
    -- Staff entered terms as months (2) or as days (60 = 2 months, 62 = already the 31-day form).
    -- A multiple of 31 or 30 is read as days; a small number in the loan's own unit
    -- (monthly: months; weekly: weeks, 4 weeks = 1 month). Anything else -> 'review'.
    CASE WHEN b.collection_mode = 'fixed_term' THEN
      CASE WHEN b.reference_number = 'SC-018' THEN 2::numeric  -- agreed by hand: this 2-week loan becomes a 2-month (62-day) loan
           WHEN b.duration_periods >= 31 AND b.duration_periods % 31 = 0 THEN (b.duration_periods / 31)::numeric
           WHEN b.duration_periods >= 30 AND b.duration_periods % 30 = 0 THEN (b.duration_periods / 30)::numeric
           WHEN b.interest_type = 'monthly' AND b.duration_periods BETWEEN 1 AND 27 THEN b.duration_periods::numeric
           WHEN b.interest_type = 'weekly' AND b.duration_periods BETWEEN 4 AND 24 AND b.duration_periods % 4 = 0 THEN (b.duration_periods / 4)::numeric
           ELSE NULL END
    END AS months
  FROM base b
),
terms AS (
  SELECT c.*,
    c.months * 31 AS new_periods,
    (c.principal_amount + c.principal_amount * c.interest_rate / 100 * c.months) / NULLIF(c.months * 30, 0) AS dia,
    c.principal_amount / NULLIF(c.months * 31, 0) AS ppd
  FROM calc c
),
flat AS (
  SELECT t.*,
    t.dia - t.ppd AS ipd,
    t.ppd / NULLIF(t.dia, 0) AS share,
    GREATEST(0, t.principal_amount - t.paid * (t.ppd / NULLIF(t.dia, 0))) AS flat_p,
    GREATEST(0, (t.dia - t.ppd) * t.new_periods - t.paid * (1 - t.ppd / NULLIF(t.dia, 0)))
      + CASE WHEN t.interest_balance - (t.old_accrued - t.interest_paid) > 0.01
             THEN t.interest_balance - (t.old_accrued - t.interest_paid) ELSE 0 END AS flat_i
  FROM terms t
),
final AS (
  SELECT f.*,
    CASE WHEN f.collection_mode = 'fixed_term'
         THEN CASE WHEN f.months IS NULL OR f.months <= 0 OR f.months <> trunc(f.months) THEN 'review' ELSE 'fixed_term' END
         ELSE 'open_ended' END AS mode
  FROM flat f
)
SELECT
  x.*,
  CASE x.mode WHEN 'fixed_term' THEN CASE WHEN x.flat_p <= 0.005 THEN 0 ELSE round(x.flat_p, 2) END
              WHEN 'open_ended' THEN round(x.principal_outstanding, 2) END AS new_principal_outstanding,
  CASE x.mode WHEN 'fixed_term' THEN CASE WHEN x.flat_p <= 0.005 THEN 0 ELSE round(x.flat_i, 2) END
              WHEN 'open_ended' THEN round(GREATEST(0, x.interest_balance
                + (x.today_sl - x.created_sl) * (x.principal_amount * x.interest_rate / 100 / 30) - x.old_accrued), 2) END AS new_interest_balance,
  CASE WHEN x.mode = 'fixed_term' AND x.flat_p <= 0.005 THEN 'fully_paid' ELSE x.status END AS new_status,
  CASE x.mode WHEN 'fixed_term' THEN x.new_periods::int ELSE x.duration_periods END AS new_duration_periods,
  CASE WHEN x.mode = 'fixed_term' THEN round(x.dia, 2) END AS new_daily_installment_amount,
  CASE WHEN x.mode = 'fixed_term' THEN round(x.ppd, 2) END AS new_principal_per_day,
  CASE WHEN x.mode = 'fixed_term' THEN round(x.ipd, 2) END AS new_interest_per_day,
  CASE x.mode WHEN 'fixed_term' THEN ((x.created_sl + 1)::timestamp AT TIME ZONE 'Asia/Colombo')
              WHEN 'open_ended' THEN ((x.today_sl + 1)::timestamp AT TIME ZONE 'Asia/Colombo') END AS new_next_accrual_date,
  CASE WHEN x.mode = 'fixed_term' THEN ((x.created_sl + x.new_periods::int - 1)::timestamp AT TIME ZONE 'Asia/Colombo')
       ELSE x.maturity_date END AS new_maturity_date
FROM final x;

-- The preview. Review every row: "mode" = open_ended / fixed_term / review (review rows are NOT converted).
SELECT reference_number, borrower_name, interest_type AS old_type, collection_mode, duration_periods AS old_term, mode,
       new_duration_periods AS new_term_days, new_daily_installment_amount,
       round(principal_outstanding, 2) AS principal_before, new_principal_outstanding AS principal_after,
       round(interest_balance, 2) AS interest_before, new_interest_balance AS interest_after,
       round(principal_outstanding + interest_balance, 2) AS owed_before,
       round(new_principal_outstanding + new_interest_balance, 2) AS owed_after,
       round(new_principal_outstanding + new_interest_balance - principal_outstanding - interest_balance, 2) AS change,
       new_status
FROM loan_daily_conversion_plan
ORDER BY mode, created_at;

-- Totals for the loans that would be converted:
SELECT mode, count(*) AS loans,
       round(sum(principal_outstanding + interest_balance), 2) AS owed_before,
       round(sum(new_principal_outstanding + new_interest_balance), 2) AS owed_after
FROM loan_daily_conversion_plan GROUP BY mode;


