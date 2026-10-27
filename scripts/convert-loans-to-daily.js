// Converts every already-registered active weekly/monthly loan to a daily loan
// and recalculates its interest from the start. The rules live in
// src/lib/services/dailyConversion.js (unit tested); this script only reads the
// numbers, prints/saves the plan, and — only with --apply — writes it.
//
//   node scripts/convert-loans-to-daily.js --env .env.sabesh             dry run (changes nothing)
//   node scripts/convert-loans-to-daily.js --env .env.sabesh --apply     convert
//   node scripts/convert-loans-to-daily.js --env .env.sabesh --rollback  undo a conversion
//
// --env points at a file containing Sabesh Capital's DATABASE_URL. Always read
// the dry-run report and take a database backup before --apply.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import knexFactory from 'knex';
import { planDailyConversion, conversionLedgerRows } from '../src/lib/services/dailyConversion.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const envFile = option('--env');
if (!envFile) {
  console.error('Pass --env <file> with Sabesh Capital\'s DATABASE_URL, e.g. --env .env.sabesh');
  process.exit(1);
}
dotenv.config({ path: path.resolve(envFile) });
if (!process.env.DATABASE_URL) {
  console.error(`DATABASE_URL not found in ${envFile}.`);
  process.exit(1);
}

// The STN MICRO CREDIT project's Supabase id. Its database sits in the other
// project's .env.local, so refuse it outright rather than convert STN's loans.
if (process.env.DATABASE_URL.includes('oqykfnupmtmfhxivvqfd')) {
  console.error('This DATABASE_URL is the STN MICRO CREDIT database, not Sabesh Capital\'s. Stopping.');
  process.exit(1);
}

const db = knexFactory({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
  pool: { min: 0, max: 4 },
});

const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function ensureLogTable() {
  await db.raw(`
    CREATE TABLE IF NOT EXISTS loan_daily_conversion_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      converted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      before JSONB NOT NULL,
      after JSONB NOT NULL,
      ledger_entry_ids JSONB NOT NULL DEFAULT '[]',
      rolled_back_at TIMESTAMPTZ
    )
  `);
}

async function loadPlans(now) {
  const loans = await db('loans')
    .join('users as b', 'loans.borrower_id', 'b.id')
    .select('loans.*', 'b.name as borrower_name')
    .orderBy('loans.created_at', 'asc');

  const sums = async (table, column, extra = (q) => q) => {
    const rows = await extra(db(table).select('loan_id').sum(`${column} as total`).groupBy('loan_id'));
    return new Map(rows.map((r) => [r.loan_id, Number(r.total) || 0]));
  };
  const paid = await sums('transactions', 'amount');
  const interestPaid = await sums('transactions', 'amount', (q) => q.where('payment_type', 'interest'));
  const accrued = await sums('interest_accruals', 'amount_accrued');

  return loans.map((loan) => ({
    loan,
    plan: planDailyConversion(loan, {
      totalPaid: paid.get(loan.id) || 0,
      interestPaid: interestPaid.get(loan.id) || 0,
      totalAccrued: accrued.get(loan.id) || 0,
      now,
    }),
  }));
}

function writeReport(results) {
  const header = ['Reference', 'Borrower', 'Status', 'Old type', 'Old term', 'Result', 'New term (days)', 'Daily installment',
    'Principal before', 'Principal after', 'Interest before', 'Interest after', 'Total owed before', 'Total owed after', 'Change', 'Notes'];
  const lines = [header.map(csvCell).join(',')];
  for (const { loan, plan } of results) {
    const oldTerm = loan.collection_mode === 'fixed_term' ? `${loan.duration_periods} ${loan.interest_type === 'weekly' ? 'wk' : 'mo'}` : 'open-ended';
    if (plan.skip) {
      lines.push([loan.reference_number, loan.borrower_name, loan.status, loan.interest_type, oldTerm, 'NOT CONVERTED', '', '', '', '', '', '', '', '', '', plan.reason].map(csvCell).join(','));
      continue;
    }
    const b = plan.before, a = plan.after;
    const owedBefore = b.principal_outstanding + b.interest_balance;
    const owedAfter = a.principal_outstanding + a.interest_balance;
    lines.push([
      loan.reference_number, loan.borrower_name, loan.status, loan.interest_type, oldTerm, 'CONVERT',
      plan.mode === 'fixed_term' ? a.duration_periods : 'open-ended', a.daily_installment_amount ?? '',
      b.principal_outstanding, a.principal_outstanding, b.interest_balance, a.interest_balance,
      owedBefore.toFixed(2), owedAfter.toFixed(2), (owedAfter - owedBefore).toFixed(2), plan.warnings.join(' '),
    ].map(csvCell).join(','));
  }
  const file = path.resolve(`daily-conversion-report-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

function printSummary(results) {
  const convert = results.filter((r) => !r.plan.skip);
  const skipped = results.filter((r) => r.plan.skip && r.loan.interest_type !== 'daily');
  const alreadyDaily = results.filter((r) => r.plan.skip && r.loan.interest_type === 'daily').length;
  const owedBefore = convert.reduce((s, r) => s + r.plan.before.principal_outstanding + r.plan.before.interest_balance, 0);
  const owedAfter = convert.reduce((s, r) => s + r.plan.after.principal_outstanding + r.plan.after.interest_balance, 0);
  console.log(`\nLoans in the system:          ${results.length}`);
  console.log(`Already daily (untouched):    ${alreadyDaily}`);
  console.log(`Will be converted:            ${convert.length}  (${convert.filter((r) => r.plan.mode === 'open_ended').length} open-ended, ${convert.filter((r) => r.plan.mode === 'fixed_term').length} fixed-term)`);
  console.log(`Not converted (need review):  ${skipped.length}`);
  for (const r of skipped) console.log(`   - ${r.loan.reference_number} ${r.loan.borrower_name}: ${r.plan.reason}`);
  console.log(`\nTotal owed by converted loans, before: LKR ${money(owedBefore)}`);
  console.log(`Total owed by converted loans, after:  LKR ${money(owedAfter)}  (change ${owedAfter - owedBefore >= 0 ? '+' : ''}${money(owedAfter - owedBefore)})`);
  const warned = convert.filter((r) => r.plan.warnings.length);
  if (warned.length) {
    console.log('\nLoans with warnings:');
    for (const r of warned) console.log(`   - ${r.loan.reference_number} ${r.loan.borrower_name}: ${r.plan.warnings.join(' ')}`);
  }
}

async function apply(results, now) {
  await ensureLogTable();
  const todo = results.filter((r) => !r.plan.skip);
  let done = 0;
  for (const { loan, plan } of todo) {
    await db.transaction(async (trx) => {
      const current = await trx('loans').where({ id: loan.id }).forUpdate().first();
      // Stop if anything touched the loan between the dry run and now.
      if (current.interest_type !== loan.interest_type || current.status !== loan.status
        || Number(current.principal_outstanding) !== Number(loan.principal_outstanding)
        || Number(current.interest_balance) !== Number(loan.interest_balance)) {
        throw new Error(`Loan ${loan.reference_number} changed while converting. Nothing was written for it; run the dry run again.`);
      }
      const a = plan.after;
      await trx('loans').where({ id: loan.id }).update({
        interest_type: a.interest_type,
        collection_mode: a.collection_mode,
        duration_periods: a.duration_periods,
        is_flat_installment: a.is_flat_installment,
        daily_installment_amount: a.daily_installment_amount,
        principal_per_day: a.principal_per_day,
        interest_per_day: a.interest_per_day,
        principal_outstanding: a.principal_outstanding,
        interest_balance: a.interest_balance,
        status: a.status,
        last_accrual_date: a.last_accrual_date,
        next_accrual_date: a.next_accrual_date,
        maturity_date: a.maturity_date,
        updated_at: trx.fn.now(),
      });
      const ledgerRows = conversionLedgerRows(loan.id, plan.deltaPrincipal, plan.deltaInterest);
      const ledgerIds = ledgerRows.length ? (await trx('ledger_entries').insert(ledgerRows).returning('id')).map((r) => r.id || r) : [];
      await trx('loan_daily_conversion_log').insert({
        loan_id: loan.id,
        before: JSON.stringify(plan.before),
        after: JSON.stringify(a),
        ledger_entry_ids: JSON.stringify(ledgerIds),
      });
      await trx('audit_logs').insert({
        actor_id: loan.lender_id,
        action_type: 'CONVERT_LOAN_TO_DAILY',
        description: `Loan ${loan.reference_number} converted from ${loan.interest_type} to daily. Principal LKR ${money(plan.before.principal_outstanding)} -> ${money(a.principal_outstanding)}, interest due LKR ${money(plan.before.interest_balance)} -> ${money(a.interest_balance)}.`,
      });
    });
    done += 1;
    console.log(`converted ${loan.reference_number} (${done}/${todo.length})`);
  }
  console.log(`\nDone: ${done} loan(s) converted. To undo: node scripts/convert-loans-to-daily.js --env ${envFile} --rollback`);
}

async function rollback() {
  await ensureLogTable();
  const logs = await db('loan_daily_conversion_log').whereNull('rolled_back_at').orderBy('converted_at', 'desc');
  let restored = 0;
  for (const log of logs) {
    const loan = await db('loans').where({ id: log.loan_id }).first();
    const later = await db('transactions').where({ loan_id: log.loan_id }).andWhere('created_at', '>', log.converted_at).count('id as c').first();
    if (Number(later.c) > 0) {
      console.log(`skipped ${loan?.reference_number}: ${later.c} payment(s) recorded since the conversion, so it cannot be restored automatically.`);
      continue;
    }
    await db.transaction(async (trx) => {
      const b = log.before;
      await trx('loans').where({ id: log.loan_id }).update({
        interest_type: b.interest_type, collection_mode: b.collection_mode, duration_periods: b.duration_periods,
        is_flat_installment: b.is_flat_installment, daily_installment_amount: b.daily_installment_amount,
        principal_per_day: b.principal_per_day, interest_per_day: b.interest_per_day,
        principal_outstanding: b.principal_outstanding, interest_balance: b.interest_balance, status: b.status,
        last_accrual_date: b.last_accrual_date, next_accrual_date: b.next_accrual_date, maturity_date: b.maturity_date,
        updated_at: trx.fn.now(),
      });
      const ids = log.ledger_entry_ids || [];
      if (ids.length) await trx('ledger_entries').whereIn('id', ids).del();
      await trx('loan_daily_conversion_log').where({ id: log.id }).update({ rolled_back_at: trx.fn.now() });
      await trx('audit_logs').insert({ actor_id: loan.lender_id, action_type: 'ROLLBACK_CONVERT_LOAN_TO_DAILY', description: `Conversion of loan ${loan.reference_number} to daily was rolled back.` });
    });
    restored += 1;
    console.log(`restored ${loan.reference_number}`);
  }
  console.log(`\nRolled back ${restored} loan(s).`);
}

(async () => {
  try {
    const host = new URL(process.env.DATABASE_URL).hostname;
    console.log(`Database: ${host}`);
    if (flag('--rollback')) { await rollback(); return; }
    const now = new Date();
    const results = await loadPlans(now);
    printSummary(results);
    const file = writeReport(results);
    console.log(`\nFull per-loan report: ${file}`);
    if (!flag('--apply')) {
      console.log('\nDRY RUN: nothing was changed. Review the report, take a backup, then re-run with --apply.');
      return;
    }
    await apply(results, now);
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
})();
