import db from '../db.js';
import { addInterval, isValidSriLankanNIC } from '../loanSchedule.js';
import { validateImageDataUrlArray } from './image.js';
import {
  calculateInterestPerPeriod,
  computeAccrualBatch,
  computeStandardPayment,
  nextReferenceNumber
} from './loanMath.js';
import {
  PAWN_GRACE_DAYS,
  PAWN_ACCOUNTS,
  getPawnStatusInfo,
  computeForfeitSettlement,
  disbursementEntries,
  accrualEntries,
  paymentEntries,
  forfeitEntries
} from './pawnMath.js';
import {
  notifyPawnCreated,
  notifyPawnPayment,
  notifyPawnExtended,
  notifyPawnForfeited,
  notifyPawnReminder
} from './pawnNotifications.js';
import { logError } from '../logger.js';

export class PawnError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const INTEREST_TYPES = ['daily', 'weekly', 'monthly'];
const PAWN_TYPES = ['vehicle', 'gold'];
const PHOTO_ERROR = 'Upload 1-4 valid JPEG/PNG/WebP images (each under 4MB).';

const clean = (v) => (typeof v === 'string' ? v.trim() : v);
const orNull = (v) => {
  const c = clean(v);
  return c === undefined || c === null || c === '' ? null : c;
};
const numOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? NaN : n;
};

// What list/detail responses add on top of a raw row: the overdue / forfeit
// timing, and how much of the item's estimated value is lent out.
export function withPawnStatus(loan, now = new Date()) {
  const info = getPawnStatusInfo({ status: loan.status, dueDate: loan.due_date, now });
  const estimated = parseFloat(loan.estimated_value) || 0;
  return {
    ...loan,
    is_overdue: info.isOverdue,
    days_overdue: info.daysOverdue,
    days_until_due: info.daysUntilDue,
    can_forfeit: info.canForfeit,
    days_until_forfeitable: info.isOverdue ? info.daysUntilForfeitable : null,
    loan_to_value_percent: estimated > 0 ? Math.round((parseFloat(loan.principal_amount) / estimated) * 1000) / 10 : null,
    total_outstanding: Math.round(((parseFloat(loan.principal_outstanding) || 0) + (parseFloat(loan.interest_balance) || 0)) * 100) / 100
  };
}

async function insertLedger(trx, loanId, paymentId, rows) {
  if (!rows.length) return;
  await trx('pawn_ledger_entries').insert(
    rows.map((r) => ({ pawn_loan_id: loanId, pawn_payment_id: paymentId || null, account: r.account, type: r.type, amount: r.amount }))
  );
}

async function audit(trx, actorId, actionType, description) {
  await trx('audit_logs').insert({ actor_id: actorId, action_type: actionType, description });
}

async function lockActiveLoan(trx, loanId) {
  const loan = await trx('pawn_loans').where({ id: loanId }).first().forUpdate();
  if (!loan) throw new PawnError(404, 'Pawn loan not found.');
  return loan;
}

const NOT_ACTIVE_MESSAGES = {
  redeemed: 'This pawn loan has already been fully paid (redeemed).',
  forfeited: 'This pawn loan has been forfeited and no longer accepts changes.'
};

function assertActive(loan) {
  if (loan.status !== 'active') {
    throw new PawnError(400, NOT_ACTIVE_MESSAGES[loan.status] || 'This pawn loan is not active.');
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createPawnLoan(input, actorId) {
  const customerName = clean(input.customer_name);
  const nic = clean(input.nic_number)?.toUpperCase();
  const mobile = clean(input.mobile);
  if (!customerName || !nic || !mobile) throw new PawnError(400, 'Customer name, NIC number and mobile number are required.');
  if (!isValidSriLankanNIC(nic)) {
    throw new PawnError(400, 'Invalid Sri Lankan NIC number format. Use 9 digits with V/X (e.g. 123456789V) or 12 digits (e.g. 199012345678).');
  }

  const pawnType = clean(input.pawn_type);
  if (!PAWN_TYPES.includes(pawnType)) throw new PawnError(400, "Pawn type must be 'vehicle' or 'gold'.");
  const itemDescription = clean(input.item_description);
  if (!itemDescription) throw new PawnError(400, 'Please describe the pawned item.');

  const estimatedValue = parseFloat(input.estimated_value);
  const principal = parseFloat(input.principal_amount);
  const rate = parseFloat(input.interest_rate);
  if (Number.isNaN(estimatedValue) || estimatedValue <= 0) throw new PawnError(400, 'Estimated value must be a positive number.');
  if (Number.isNaN(principal) || principal <= 0) throw new PawnError(400, 'Loan amount must be a positive number.');
  if (Number.isNaN(rate) || rate < 0) throw new PawnError(400, 'Interest rate must be zero or more.');

  const interestType = clean(input.interest_type) || 'monthly';
  if (!INTEREST_TYPES.includes(interestType)) throw new PawnError(400, 'Invalid interest type. Use daily, weekly, or monthly.');

  const periodMonths = parseInt(input.period_months ?? 1, 10);
  if (Number.isNaN(periodMonths) || periodMonths < 1 || periodMonths > 60) {
    throw new PawnError(400, 'Loan period must be between 1 and 60 months.');
  }

  const monthlyIncome = numOrNull(input.monthly_income);
  if (Number.isNaN(monthlyIncome)) throw new PawnError(400, 'Monthly income must be a number.');
  const goldWeight = numOrNull(input.gold_weight_grams);
  if (Number.isNaN(goldWeight) || (goldWeight !== null && goldWeight <= 0)) throw new PawnError(400, 'Gold weight must be a positive number of grams.');

  let startDate = new Date();
  if (input.start_date) {
    startDate = new Date(input.start_date);
    if (Number.isNaN(startDate.getTime())) throw new PawnError(400, 'Invalid start date.');
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (startDate > endOfToday) throw new PawnError(400, 'Start date cannot be in the future.');
  }

  let itemPhotos = null;
  if (Array.isArray(input.item_photos) && input.item_photos.length) {
    itemPhotos = validateImageDataUrlArray(input.item_photos);
    if (!itemPhotos) throw new PawnError(400, `Item photos: ${PHOTO_ERROR}`);
  }
  let documentPhotos = null;
  if (Array.isArray(input.document_photos) && input.document_photos.length) {
    documentPhotos = validateImageDataUrlArray(input.document_photos);
    if (!documentPhotos) throw new PawnError(400, `Document photos: ${PHOTO_ERROR}`);
  }

  const dueDate = addInterval(startDate, 'monthly', periodMonths);
  const nextAccrualDate = addInterval(startDate, interestType);

  const loan = await db.transaction(async (trx) => {
    // Serialise reference-number allocation so two simultaneous new loans
    // can't both pick the same PWN-00X.
    await trx.raw('SELECT pg_advisory_xact_lock(7202610)');
    const { rows } = await trx.raw("SELECT MAX(CAST(SUBSTRING(reference_number FROM '[0-9]+$') AS INTEGER)) AS max_num FROM pawn_loans");
    const reference = nextReferenceNumber('PWN', rows[0]?.max_num);

    const [created] = await trx('pawn_loans').insert({
      reference_number: reference,
      customer_name: customerName,
      father_husband_name: orNull(input.father_husband_name),
      address: orNull(input.address),
      nic_number: nic,
      mobile,
      occupation: orNull(input.occupation),
      monthly_income: monthlyIncome,
      reference_name: orNull(input.reference_name),
      reference_phone: orNull(input.reference_phone),
      pawn_type: pawnType,
      item_description: itemDescription,
      make_model: pawnType === 'vehicle' ? orNull(input.make_model) : null,
      registration_serial: orNull(input.registration_serial),
      gold_weight_grams: pawnType === 'gold' ? goldWeight : null,
      gold_karat: pawnType === 'gold' ? orNull(input.gold_karat) : null,
      estimated_value: estimatedValue,
      storage_location: orNull(input.storage_location),
      item_photo_urls: itemPhotos ? JSON.stringify(itemPhotos) : null,
      document_photo_urls: documentPhotos ? JSON.stringify(documentPhotos) : null,
      principal_amount: principal,
      interest_rate: rate,
      interest_type: interestType,
      period_months: periodMonths,
      principal_outstanding: principal,
      interest_balance: 0,
      start_date: startDate,
      due_date: dueDate,
      next_accrual_date: nextAccrualDate,
      status: 'active',
      notes: orNull(input.notes),
      created_by: actorId
    }).returning('*');

    await insertLedger(trx, created.id, null, disbursementEntries(principal));
    await audit(trx, actorId, 'CREATE_PAWN_LOAN', `Created pawn loan ${created.reference_number} of LKR ${principal.toLocaleString()} (${pawnType}, estimated value LKR ${estimatedValue.toLocaleString()}) for '${customerName}', NIC ${nic}.`);
    return created;
  });

  notifyPawnCreated(loan).catch((err) => logError('Pawn created notification failed', err, { loanId: loan.id }));
  return loan;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export async function recordPawnPayment({ loanId, amount, paymentType, notes, paymentMethod, idempotencyKey, paymentDate }, actorId) {
  const payAmount = parseFloat(amount);
  if (Number.isNaN(payAmount) || payAmount <= 0) throw new PawnError(400, 'Amount must be a positive number.');
  if (!['interest', 'principal'].includes(paymentType)) throw new PawnError(400, "Payment type must be 'interest' or 'principal'.");
  if (!idempotencyKey) throw new PawnError(400, 'An idempotency key is required.');

  let parsedDate;
  if (paymentDate) {
    parsedDate = new Date(paymentDate);
    if (Number.isNaN(parsedDate.getTime())) throw new PawnError(400, 'Payment date is invalid.');
    if (parsedDate > new Date(Date.now() + 60 * 60 * 1000)) throw new PawnError(400, 'Payment date cannot be in the future.');
  }

  const existing = await db('pawn_payments').where({ idempotency_key: idempotencyKey }).first();
  if (existing) throw new PawnError(409, 'This payment has already been recorded (duplicate detected).');

  const result = await db.transaction(async (trx) => {
    const loan = await lockActiveLoan(trx, loanId);
    assertActive(loan);

    let computed;
    try {
      computed = computeStandardPayment({
        paymentType,
        payAmount,
        principalOutstanding: parseFloat(loan.principal_outstanding),
        interestBalance: parseFloat(loan.interest_balance)
      });
    } catch (err) {
      throw new PawnError(400, err.message);
    }

    const [payment] = await trx('pawn_payments').insert({
      pawn_loan_id: loan.id,
      amount: payAmount,
      payment_type: paymentType,
      notes: orNull(notes),
      payment_method: paymentMethod || 'cash',
      received_by: actorId,
      idempotency_key: idempotencyKey,
      ...(parsedDate ? { payment_date: parsedDate } : {})
    }).returning('*');

    const newPrincipal = computed.newPrincipalOutstanding;
    const newInterest = computed.newInterestBalance;
    // Redeemed only once BOTH principal and interest are fully cleared.
    const redeemed = newPrincipal <= 0 && newInterest <= 0;

    await insertLedger(trx, loan.id, payment.id, paymentEntries(paymentType, payAmount));
    const [updated] = await trx('pawn_loans').where({ id: loan.id }).update({
      principal_outstanding: newPrincipal,
      interest_balance: newInterest,
      status: redeemed ? 'redeemed' : 'active',
      updated_at: db.fn.now()
    }).returning('*');

    await audit(trx, actorId, 'PAWN_PAYMENT', `Collected ${paymentType} payment of LKR ${payAmount.toLocaleString()} for pawn loan ${loan.reference_number}. Remaining: principal LKR ${Number(newPrincipal).toLocaleString()}, interest LKR ${Number(newInterest).toLocaleString()}${redeemed ? ' — loan redeemed.' : '.'}`);
    return { payment, loan: updated, redeemed };
  });

  notifyPawnPayment(result.loan, { amount: payAmount, paymentType, redeemed: result.redeemed })
    .catch((err) => logError('Pawn payment notification failed', err, { loanId }));
  return result;
}

// ---------------------------------------------------------------------------
// Interest accrual — same engine as the cash loans (interest.js), run by
// the same daily cron.
// ---------------------------------------------------------------------------
export async function runPawnAccruals(loanId) {
  let query = db('pawn_loans')
    .where('status', 'active')
    // Once the principal is fully repaid nothing more should build up; only
    // the remaining interest is left to collect.
    .andWhere('principal_outstanding', '>', 0)
    .andWhere('next_accrual_date', '<=', db.fn.now());
  if (loanId) query = query.andWhere('id', loanId);
  const due = await query;

  const results = [];
  for (const row of due) {
    try {
      const result = await db.transaction(async (trx) => {
        const loan = await trx('pawn_loans').where({ id: row.id }).first().forUpdate();
        if (loan.status !== 'active' || new Date(loan.next_accrual_date) > new Date()) {
          return { loanId: row.id, status: 'skipped' };
        }

        // Matches the cash loans: interest is worked out on the ORIGINAL
        // principal_amount each period (see interest.js), not the reducing
        // balance. Interest keeps building after the due date until the
        // loan is paid off or forfeited.
        const principal = parseFloat(loan.principal_amount);
        const rate = parseFloat(loan.interest_rate);
        const perPeriod = calculateInterestPerPeriod(principal, rate, loan.interest_type);
        const batch = computeAccrualBatch({
          interestType: loan.interest_type,
          interestPerPeriod: perPeriod,
          startingInterestBalance: parseFloat(loan.interest_balance),
          nextAccrualDate: loan.next_accrual_date,
          now: new Date()
        });
        if (batch.periods.length === 0) return { loanId: row.id, status: 'skipped' };

        for (const period of batch.periods) {
          await trx('pawn_interest_accruals').insert({
            pawn_loan_id: loan.id,
            amount_accrued: period.amount,
            calculation_log: `Principal: ${principal} | Rate: ${rate}% per month | Type: ${loan.interest_type} | Accrual period for ${period.date.toISOString().slice(0, 10)}`
          });
        }

        await insertLedger(trx, loan.id, null, accrualEntries(batch.totalAccrued));
        await trx('pawn_loans').where({ id: loan.id }).update({
          interest_balance: batch.runningInterestBalance,
          last_accrual_date: db.fn.now(),
          next_accrual_date: batch.nextAccrualDate,
          updated_at: db.fn.now()
        });
        await audit(trx, loan.created_by, 'PAWN_ACCRUE_INTEREST', `Accrued interest of LKR ${batch.totalAccrued.toLocaleString()} (${batch.periods.length} period${batch.periods.length === 1 ? '' : 's'}) on pawn loan ${loan.reference_number}. Interest due: LKR ${batch.runningInterestBalance.toLocaleString()}.`);
        return { loanId: loan.id, accruedAmount: batch.totalAccrued, periodsAccrued: batch.periods.length, status: 'accrued' };
      });
      results.push(result);
    } catch (err) {
      logError('Error accruing pawn interest', err, { loanId: row.id });
      results.push({ loanId: row.id, status: 'error', error: err.message });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Extend, return item, forfeit
// ---------------------------------------------------------------------------
export async function extendPawnLoan({ loanId, additionalMonths, reason }, actorId) {
  const months = parseInt(additionalMonths, 10);
  if (Number.isNaN(months) || months < 1 || months > 12) throw new PawnError(400, 'Extend by between 1 and 12 months.');

  const loan = await db.transaction(async (trx) => {
    const current = await lockActiveLoan(trx, loanId);
    assertActive(current);
    const [updated] = await trx('pawn_loans').where({ id: loanId }).update({
      due_date: addInterval(new Date(current.due_date), 'monthly', months),
      period_months: current.period_months + months,
      updated_at: db.fn.now()
    }).returning('*');
    await audit(trx, actorId, 'EXTEND_PAWN_LOAN', `Extended pawn loan ${current.reference_number} by ${months} month${months === 1 ? '' : 's'}${clean(reason) ? ` (${clean(reason)})` : ''}. New due date: ${new Date(updated.due_date).toISOString().slice(0, 10)}.`);
    return updated;
  });

  notifyPawnExtended(loan, { additionalMonths: months }).catch((err) => logError('Pawn extend notification failed', err, { loanId }));
  return loan;
}

export async function returnPawnItem({ loanId, note }, actorId) {
  return db.transaction(async (trx) => {
    const loan = await lockActiveLoan(trx, loanId);
    if (loan.status !== 'redeemed') throw new PawnError(400, 'The item can only be returned once the loan is fully paid (redeemed).');
    if (loan.item_returned_at) throw new PawnError(400, 'This item has already been marked as returned.');
    const [updated] = await trx('pawn_loans').where({ id: loanId }).update({ item_returned_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
    await audit(trx, actorId, 'PAWN_ITEM_RETURNED', `Returned the pledged item for pawn loan ${loan.reference_number} to '${loan.customer_name}'${clean(note) ? ` (${clean(note)})` : ''}.`);
    return updated;
  });
}

export async function forfeitPawnLoan({ loanId, reason, auctionProceeds, allowEarly }, actorId) {
  const why = clean(reason);
  if (!why) throw new PawnError(400, 'A reason is required to forfeit a pawn loan.');
  const proceeds = auctionProceeds === undefined || auctionProceeds === null || auctionProceeds === '' ? 0 : parseFloat(auctionProceeds);
  if (Number.isNaN(proceeds) || proceeds < 0) throw new PawnError(400, 'Auction proceeds must be zero or more.');

  const loan = await db.transaction(async (trx) => {
    const current = await lockActiveLoan(trx, loanId);
    assertActive(current);

    const info = getPawnStatusInfo({ status: current.status, dueDate: current.due_date });
    if (!info.canForfeit && !allowEarly) {
      throw new PawnError(400, info.isOverdue
        ? `The ${PAWN_GRACE_DAYS}-day grace period has not finished — ${info.daysUntilForfeitable} more day${info.daysUntilForfeitable === 1 ? '' : 's'} before this item can be forfeited.`
        : 'This loan is not overdue yet, so it cannot be forfeited.');
    }

    const settlement = computeForfeitSettlement({
      proceeds,
      principalOutstanding: parseFloat(current.principal_outstanding),
      interestBalance: parseFloat(current.interest_balance)
    });

    await insertLedger(trx, current.id, null, forfeitEntries(settlement));
    const [updated] = await trx('pawn_loans').where({ id: loanId }).update({
      status: 'forfeited',
      principal_outstanding: 0,
      interest_balance: 0,
      forfeited_at: db.fn.now(),
      forfeit_reason: why,
      auction_proceeds: settlement.proceeds,
      surplus_due: settlement.surplus,
      updated_at: db.fn.now()
    }).returning('*');

    await audit(trx, actorId, 'FORFEIT_PAWN_LOAN', `Forfeited pawn loan ${current.reference_number}${!info.canForfeit ? ' EARLY (before the grace period ended)' : ''}. Reason: ${why}. Proceeds LKR ${settlement.proceeds.toLocaleString()}; surplus owed to customer LKR ${settlement.surplus.toLocaleString()}; written off LKR ${(settlement.writtenOffPrincipal + settlement.writtenOffInterest).toLocaleString()}.`);
    return { ...updated, _settlement: settlement };
  });

  notifyPawnForfeited(loan).catch((err) => logError('Pawn forfeit notification failed', err, { loanId }));
  return loan;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
const LIST_COLUMNS = [
  'id', 'reference_number', 'customer_name', 'nic_number', 'mobile', 'pawn_type', 'item_description',
  'estimated_value', 'principal_amount', 'interest_rate', 'interest_type', 'period_months',
  'principal_outstanding', 'interest_balance', 'start_date', 'due_date', 'status',
  'item_returned_at', 'forfeited_at', 'storage_location', 'created_at'
];

export async function listPawnLoans({ status, search } = {}) {
  let q = db('pawn_loans').select(LIST_COLUMNS).orderBy('created_at', 'desc');
  if (status && ['active', 'redeemed', 'forfeited'].includes(status)) q = q.where({ status });
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    q = q.where((b) => b.whereILike('customer_name', term).orWhereILike('nic_number', term).orWhereILike('mobile', term).orWhereILike('reference_number', term).orWhereILike('item_description', term));
  }
  const rows = await q;
  return rows.map((r) => withPawnStatus(r));
}

export async function getPawnLoanDetail(id) {
  const loan = await db('pawn_loans').where({ id }).first();
  if (!loan) throw new PawnError(404, 'Pawn loan not found.');
  const [payments, accruals, ledger] = await Promise.all([
    db('pawn_payments').leftJoin('users', 'pawn_payments.received_by', 'users.id')
      .where({ pawn_loan_id: id }).select('pawn_payments.*', 'users.name as received_by_name').orderBy('payment_date', 'desc'),
    db('pawn_interest_accruals').where({ pawn_loan_id: id }).orderBy('created_at', 'desc').limit(24),
    db('pawn_ledger_entries').where({ pawn_loan_id: id }).orderBy('created_at', 'asc')
  ]);
  return { loan: withPawnStatus(loan), payments, accruals, ledger };
}

export async function getPawnSummary() {
  const rows = await db('pawn_loans').select(LIST_COLUMNS);
  const loans = rows.map((r) => withPawnStatus(r));
  const active = loans.filter((l) => l.status === 'active');
  const sum = (arr, key) => Math.round(arr.reduce((a, l) => a + (parseFloat(l[key]) || 0), 0) * 100) / 100;

  const accounts = await db('pawn_ledger_entries')
    .select('account', 'type').sum('amount as total').groupBy('account', 'type');
  const balances = {};
  for (const a of Object.values(PAWN_ACCOUNTS)) balances[a] = { debit: 0, credit: 0 };
  for (const r of accounts) {
    if (!balances[r.account]) balances[r.account] = { debit: 0, credit: 0 };
    balances[r.account][r.type] = Math.round((parseFloat(r.total) || 0) * 100) / 100;
  }
  const totalDebit = Object.values(balances).reduce((a, b) => a + b.debit, 0);
  const totalCredit = Object.values(balances).reduce((a, b) => a + b.credit, 0);

  return {
    counts: {
      active: active.length,
      overdue: active.filter((l) => l.is_overdue).length,
      forfeitable: active.filter((l) => l.can_forfeit).length,
      redeemed: loans.filter((l) => l.status === 'redeemed').length,
      awaitingReturn: loans.filter((l) => l.status === 'redeemed' && !l.item_returned_at).length,
      forfeited: loans.filter((l) => l.status === 'forfeited').length
    },
    totals: {
      totalLent: sum(loans, 'principal_amount'),
      principalOutstanding: sum(active, 'principal_outstanding'),
      interestDue: sum(active, 'interest_balance'),
      estimatedValueHeld: sum(active, 'estimated_value')
    },
    ledger: {
      accounts: Object.entries(balances).map(([account, b]) => ({ account, ...b, net: Math.round((b.debit - b.credit) * 100) / 100 })),
      balanced: Math.round((totalDebit - totalCredit) * 100) / 100 === 0
    }
  };
}

// ---------------------------------------------------------------------------
// Reminders (run daily by /api/cron/payment-reminders)
// ---------------------------------------------------------------------------
export async function runPawnReminders() {
  const settings = await db('org_settings').first();
  const threshold = settings?.overdue_reminder_threshold_days ?? 1;
  const loans = await db('pawn_loans').where({ status: 'active' });

  const results = [];
  for (const loan of loans) {
    const info = getPawnStatusInfo({ status: loan.status, dueDate: loan.due_date });
    let kind = null;
    if (info.isOverdue) {
      // Day 1, the middle of the grace period, and the last day of it.
      if ([1, 15, PAWN_GRACE_DAYS].includes(info.daysOverdue)) kind = 'overdue';
    } else if (info.daysUntilDue === 0) {
      kind = 'today';
    } else if (threshold > 0 && info.daysUntilDue === threshold) {
      kind = 'soon';
    }
    if (!kind) {
      results.push({ loanId: loan.id, status: 'skipped' });
      continue;
    }
    try {
      await notifyPawnReminder(loan, { kind, daysUntilDue: info.daysUntilDue, daysOverdue: info.daysOverdue });
      results.push({ loanId: loan.id, status: 'sent', kind });
    } catch (err) {
      logError('Error sending pawn reminder', err, { loanId: loan.id });
      results.push({ loanId: loan.id, status: 'error', error: err.message });
    }
  }
  return results;
}
