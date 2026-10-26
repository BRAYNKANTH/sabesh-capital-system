import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { logError } from '@/lib/logger.js';

const ACCOUNT_LABELS = {
  cash_agent: 'Cash in Agent Hands',
  cash_in_transit: 'Cash in Transit (Remitted, Unverified)',
  cash_office: 'Cash at Office',
  loan_receivable_principal: 'Loans Receivable (Principal)',
  loan_receivable_interest: 'Loans Receivable (Interest)',
  // Legacy — entries posted before the principal/interest split (see the
  // "Audit fixes" changes) still carry this old combined account name.
  // Kept here purely so old rows render a readable label instead of the
  // raw snake_case key; nothing posts to this account anymore.
  loan_receivable: 'Loans Receivable (Legacy, Pre-Split)',
  interest_revenue: 'Interest Revenue',
  penalty_revenue: 'Penalty Revenue',
  written_off_expense: 'Bad Debt Written Off',
  chit_collections: 'Chit Fund Collections'
};

// Consolidated ledger / trial balance report (Admin only)
export async function GET(request) {
  try {
    await requireAuth(request, ['admin']);
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');

    let query = db('ledger_entries').select('account', 'type').sum('amount as total').groupBy('account', 'type');
    if (from) query = query.andWhere('created_at', '>=', new Date(from));
    if (to) query = query.andWhere('created_at', '<=', new Date(to));

    const rows = await query;

    const byAccount = {};
    for (const row of rows) {
      if (!byAccount[row.account]) {
        byAccount[row.account] = { account: row.account, label: ACCOUNT_LABELS[row.account] || row.account, debit: 0, credit: 0 };
      }
      byAccount[row.account][row.type] = parseFloat(row.total) || 0;
    }

    const accounts = Object.values(byAccount).map((a) => ({ ...a, net: a.debit - a.credit }));

    const totals = accounts.reduce(
      (acc, a) => ({ debit: acc.debit + a.debit, credit: acc.credit + a.credit }),
      { debit: 0, credit: 0 }
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      range: { from: from || null, to: to || null },
      accounts,
      totals: { ...totals, balanced: Math.abs(totals.debit - totals.credit) < 0.01 }
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Ledger report error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to build ledger report.' }, { status: 500 });
  }
}
