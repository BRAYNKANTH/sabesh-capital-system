// Standalone migration script — run manually via `npm run db:migrate`,
// pointed at DATABASE_URL. Not run inside serverless functions: Vercel
// functions are short-lived and shouldn't carry schema-check overhead on
// every cold start, so this is a deliberate out-of-band step (run it once
// locally against your Supabase/Neon URL before first deploy, and again
// whenever the schema changes).
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const { default: db } = await import('../src/lib/db.js');
const { default: bcrypt } = await import('bcryptjs');

// Pre-hashed 'password123'
const HASHED_PASSWORD = '$2a$10$x536khR6NXKb2iCs08Q8E.6KO32STJCDvHyUTGWdW4AB8vI1vL9cS';

async function addColumnIfMissing(tableName, columnName, buildColumn) {
  const hasColumn = await db.schema.hasColumn(tableName, columnName);
  if (!hasColumn) {
    await db.schema.alterTable(tableName, (table) => buildColumn(table));
    console.log(`Migration: added column '${columnName}' to '${tableName}'.`);
  }
}

async function dropColumnIfPresent(tableName, columnName) {
  const hasColumn = await db.schema.hasColumn(tableName, columnName);
  if (hasColumn) {
    await db.schema.alterTable(tableName, (table) => table.dropColumn(columnName));
    console.log(`Migration: dropped column '${columnName}' from '${tableName}'.`);
  }
}

async function runIncrementalMigrations() {
  await addColumnIfMissing('users', 'must_change_password', (t) => t.boolean('must_change_password').defaultTo(false));
  await addColumnIfMissing('users', 'failed_login_attempts', (t) => t.integer('failed_login_attempts').defaultTo(0));
  await addColumnIfMissing('users', 'locked_until', (t) => t.timestamp('locked_until').nullable());

  // Login is phone-based now — email is no longer required.
  await db.schema.alterTable('users', (table) => {
    table.string('email', 100).nullable().alter();
  });

  // NOTE: a one-time "set the seeded admin's phone to STN's real business
  // number" step used to live here. It unconditionally overwrote whatever
  // phone number was on that seeded admin row every single time this
  // script ran — harmless while this codebase only ever ran against STN's
  // own database, but actively destructive now that the same seed IDs get
  // reused across every new organization's database (see the
  // scripts/tmp-onboard-*.mjs pattern): re-running `db:migrate` against an
  // already-onboarded org silently reset their real admin phone number
  // back to STN's. Removed rather than left in — it already did its
  // one-time job for STN long ago, and has no legitimate reason to run
  // again for anyone.

  await addColumnIfMissing('loans', 'default_reason', (t) => t.text('default_reason').nullable());
  await addColumnIfMissing('loans', 'defaulted_at', (t) => t.timestamp('defaulted_at').nullable());

  // Interest-only loan model: principal_outstanding never grows from interest
  // (only principal payments touch it); interest_balance tracks unpaid
  // accrued interest separately, cleared by interest payments. Replaces the
  // earlier combined current_balance field.
  const hasOldBalanceCol = await db.schema.hasColumn('loans', 'current_balance');
  const hasNewPrincipalCol = await db.schema.hasColumn('loans', 'principal_outstanding');
  if (hasOldBalanceCol && !hasNewPrincipalCol) {
    await db.schema.alterTable('loans', (table) => table.renameColumn('current_balance', 'principal_outstanding'));
    console.log("Migration: renamed loans.current_balance -> loans.principal_outstanding.");
  }
  await addColumnIfMissing('loans', 'interest_balance', (t) => t.decimal('interest_balance', 15, 2).notNullable().defaultTo(0));

  // Installment-schedule feature removed — loans are interest-only now
  // (fixed principal, recurring interest, principal repaid whenever ready).
  await dropColumnIfPresent('loans', 'num_installments');
  await dropColumnIfPresent('loans', 'installment_amount');
  await dropColumnIfPresent('loans', 'total_repayable');
  if (await db.schema.hasTable('installments')) {
    await db.schema.dropTable('installments');
    console.log("Migration: dropped table 'installments'.");
  }

  // Every payment must say whether it's paying off interest or principal.
  await addColumnIfMissing('transactions', 'payment_type', (t) => t.string('payment_type', 20).notNullable().defaultTo('principal'));

  // Borrower profile snapshot at time of loan application (mirrors the STN
  // applicant personal-info form) — optional, per-loan like the guarantor.
  await addColumnIfMissing('loans', 'loan_purpose', (t) => t.text('loan_purpose').nullable());
  await addColumnIfMissing('loans', 'dependents_count', (t) => t.integer('dependents_count').nullable());
  await addColumnIfMissing('loans', 'monthly_income', (t) => t.decimal('monthly_income', 15, 2).nullable());
  await addColumnIfMissing('loans', 'spouse_name', (t) => t.string('spouse_name', 150).nullable());
  await addColumnIfMissing('loans', 'spouse_nic', (t) => t.string('spouse_nic', 50).nullable());
  await addColumnIfMissing('loans', 'spouse_occupation', (t) => t.string('spouse_occupation', 150).nullable());

  if (!(await db.schema.hasTable('remittances'))) {
    await db.schema.createTable('remittances', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.uuid('agent_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.decimal('amount', 15, 2).notNullable();
      table.text('notes');
      table.string('status', 20).notNullable().defaultTo('pending');
      table.uuid('verified_by').references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('verified_at').nullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    console.log("Migration: created table 'remittances'.");
  }

  if (!(await db.schema.hasTable('guarantors'))) {
    await db.schema.createTable('guarantors', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.uuid('loan_id').notNullable().references('id').inTable('loans').onDelete('CASCADE');
      table.string('full_name', 150).notNullable();
      table.string('nic_number', 50).notNullable();
      table.string('gender', 10);
      table.string('ethnicity', 100);
      table.date('date_of_birth');
      table.text('address').nullable();
      table.string('phone', 20).notNullable();
      table.string('email', 100);
      table.boolean('protected_under_debt_act').defaultTo(false);
      table.boolean('has_pending_court_cases').defaultTo(false);
      table.decimal('monthly_income_business', 15, 2).defaultTo(0);
      table.decimal('monthly_income_agriculture', 15, 2).defaultTo(0);
      table.decimal('monthly_income_other', 15, 2).defaultTo(0);
      table.decimal('monthly_expense_food', 15, 2).defaultTo(0);
      table.decimal('monthly_expense_rent', 15, 2).defaultTo(0);
      table.decimal('monthly_expense_other', 15, 2).defaultTo(0);
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    console.log("Migration: created table 'guarantors'.");
  }

  // Day-by-day collection log (mirrors the physical passbook: did the
  // borrower pay today or not). 'paid'/'partial' rows are linked to a real
  // transaction so the log stays consistent with the ledger — it's a view
  // on top of real payments, not a separate source of truth.
  if (!(await db.schema.hasTable('daily_collections'))) {
    await db.schema.createTable('daily_collections', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.uuid('loan_id').notNullable().references('id').inTable('loans').onDelete('CASCADE');
      table.date('collection_date').notNullable();
      table.string('status', 20).notNullable(); // 'paid', 'partial', 'not_paid'
      table.decimal('amount', 15, 2).nullable();
      table.uuid('transaction_id').references('id').inTable('transactions').onDelete('SET NULL');
      table.uuid('marked_by').references('id').inTable('users').onDelete('SET NULL');
      table.text('notes').nullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.unique(['loan_id', 'collection_date']);
    });
    console.log("Migration: created table 'daily_collections'.");
  }

  // Borrowers no longer log in — the app collects full KYC details
  // (address, etc.) at loan disbursement instead of via a borrower
  // self-service account. Address is captured per-loan, the same as
  // nic_number, since it's part of the loan file the physical passbook
  // records at disbursement time.
  await addColumnIfMissing('loans', 'borrower_address', (t) => t.text('borrower_address').nullable());

  // Write-off support — previously a defaulted loan's balances sat on the
  // books forever with no way to formally close them out as bad debt.
  await addColumnIfMissing('loans', 'write_off_amount', (t) => t.decimal('write_off_amount', 15, 2).nullable());
  await addColumnIfMissing('loans', 'write_off_reason', (t) => t.text('write_off_reason').nullable());
  await addColumnIfMissing('loans', 'written_off_at', (t) => t.timestamp('written_off_at').nullable());

  // Remittances can now be disputed/rejected, not just verified.
  await addColumnIfMissing('remittances', 'rejection_reason', (t) => t.text('rejection_reason').nullable());

  await addColumnIfMissing('loans', 'collection_mode', (t) => t.string('collection_mode', 30).notNullable().defaultTo('passbook'));
  await addColumnIfMissing('loans', 'duration_periods', (t) => t.integer('duration_periods').nullable());
  await addColumnIfMissing('loans', 'maturity_date', (t) => t.timestamp('maturity_date').nullable());

  // Add gender column to users table
  await addColumnIfMissing('users', 'gender', (t) => t.string('gender', 10).nullable());

  // reference_number existed in the fresh-install schema but was never
  // added here — a DB that went through incremental migrations instead of
  // a fresh install would never actually get this column.
  await addColumnIfMissing('loans', 'reference_number', (t) => t.string('reference_number', 50).unique().nullable());

  // Agent-submitted loan applications ("status": 'pending') need
  // admin sign-off before they're actually disbursed — see the loans
  // create/approve/reject routes.
  await addColumnIfMissing('loans', 'approved_by', (t) => t.uuid('approved_by').references('id').inTable('users').onDelete('SET NULL'));
  await addColumnIfMissing('loans', 'approved_at', (t) => t.timestamp('approved_at').nullable());
  await addColumnIfMissing('loans', 'loan_rejection_reason', (t) => t.text('loan_rejection_reason').nullable());
  await addColumnIfMissing('loans', 'rejected_at', (t) => t.timestamp('rejected_at').nullable());

  // Borrower's date of birth, captured per-loan alongside NIC/address (same
  // pattern — these are per-application KYC snapshot fields, not shared
  // account fields on the users table).
  await addColumnIfMissing('loans', 'date_of_birth', (t) => t.date('date_of_birth').nullable());

  // Guarantor NIC photo — mirrors loans.nic_photo_url (base64 data URL,
  // stored directly in the DB since Vercel's filesystem is ephemeral).
  await addColumnIfMissing('guarantors', 'nic_photo_url', (t) => t.text('nic_photo_url').nullable());

  // Address proof photo (e.g. a utility bill or similar), required at loan
  // creation for both the borrower and every guarantor — same base64-in-DB
  // storage pattern as the NIC photos.
  await addColumnIfMissing('loans', 'address_proof_url', (t) => t.text('address_proof_url').nullable());
  await addColumnIfMissing('guarantors', 'address_proof_url', (t) => t.text('address_proof_url').nullable());

  // Guarantor address was made optional at the app layer (matching
  // Skyloan's Name/Phone/NIC bar), but the column itself was still NOT
  // NULL from when the table was first created — addColumnIfMissing only
  // adds columns that don't exist yet, it can't loosen a constraint on one
  // that already does. Left as-is, a guarantor saved with no address
  // crashes loan creation with a raw Postgres constraint-violation 500
  // (this is the exact production incident that surfaced it on Skyloan).
  // Safe to run repeatedly — dropping a constraint that's already gone is
  // a no-op in Postgres.
  await db.schema.alterTable('guarantors', (table) => {
    table.text('address').nullable().alter();
  });

  // Ticket (Chit Fund) system columns
  await addColumnIfMissing('users', 'finance_access', (t) => t.boolean('finance_access').notNullable().defaultTo(true));
  await addColumnIfMissing('users', 'ticket_access', (t) => t.boolean('ticket_access').notNullable().defaultTo(true));

  // Ticket (Chit Fund) system tables
  if (!(await db.schema.hasTable('tickets'))) {
    await db.schema.createTable('tickets', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.string('name', 100).notNullable();
      table.decimal('total_value', 15, 2).notNullable();
      table.integer('member_count').notNullable();
      table.date('start_date').notNullable();
      table.string('host_fee_type', 20).notNullable(); // 'percentage', 'fixed'
      table.decimal('host_fee_value', 15, 2).notNullable();
      table.integer('current_round').notNullable().defaultTo(1);
      table.date('next_round_date').nullable();
      table.string('status', 20).notNullable().defaultTo('active'); // 'active', 'completed'
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    console.log("Migration: created table 'tickets'.");
  }

  if (!(await db.schema.hasTable('ticket_members'))) {
    await db.schema.createTable('ticket_members', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.uuid('ticket_id').notNullable().references('id').inTable('tickets').onDelete('CASCADE');
      table.string('name', 100).notNullable();
      table.string('phone', 20).nullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    console.log("Migration: created table 'ticket_members'.");
  }

  if (!(await db.schema.hasTable('ticket_auctions'))) {
    await db.schema.createTable('ticket_auctions', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.uuid('ticket_id').notNullable().references('id').inTable('tickets').onDelete('CASCADE');
      table.integer('round_number').notNullable();
      table.date('auction_date').notNullable();
      table.decimal('bid_amount', 15, 2).notNullable();
      table.uuid('winner_member_id').nullable().references('id').inTable('ticket_members').onDelete('SET NULL');
      table.decimal('winner_payout', 15, 2).notNullable();
      table.decimal('base_payment', 15, 2).notNullable();
      table.decimal('host_fee_per_member', 15, 2).notNullable();
      table.decimal('amount_per_member', 15, 2).notNullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    console.log("Migration: created table 'ticket_auctions'.");
  }

  if (!(await db.schema.hasTable('ticket_payments'))) {
    await db.schema.createTable('ticket_payments', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.uuid('auction_id').notNullable().references('id').inTable('ticket_auctions').onDelete('CASCADE');
      table.uuid('ticket_id').notNullable().references('id').inTable('tickets').onDelete('CASCADE');
      table.uuid('member_id').notNullable().references('id').inTable('ticket_members').onDelete('CASCADE');
      table.integer('round_number').notNullable();
      table.boolean('is_paid').defaultTo(false);
      table.timestamp('payment_date').nullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.unique(['auction_id', 'member_id']);
    });
    console.log("Migration: created table 'ticket_payments'.");
  }

  // Flat daily installment loans — the client's real field practice for
  // Daily + Fixed Term loans: each day's collection is one flat amount
  // that bundles BOTH principal and interest (not interest-only like every
  // other loan type). See src/lib/services/ledger.js
  // recordFlatInstallmentCollection for the split math.
  await addColumnIfMissing('loans', 'is_flat_installment', (t) => t.boolean('is_flat_installment').notNullable().defaultTo(false));
  await addColumnIfMissing('loans', 'daily_installment_amount', (t) => t.decimal('daily_installment_amount', 15, 2).nullable());
  await addColumnIfMissing('loans', 'principal_per_day', (t) => t.decimal('principal_per_day', 15, 2).nullable());
  await addColumnIfMissing('loans', 'interest_per_day', (t) => t.decimal('interest_per_day', 15, 2).nullable());

  // Records how a single flat-installment collection split between
  // principal and interest, since transactions.payment_type stays a plain
  // 'flat_installment' string (the split itself needs somewhere to live
  // for receipts/reporting to reconstruct it later).
  await addColumnIfMissing('transactions', 'principal_component', (t) => t.decimal('principal_component', 15, 2).nullable());
  await addColumnIfMissing('transactions', 'interest_component', (t) => t.decimal('interest_component', 15, 2).nullable());

  // Per-organization branding, read at runtime (header, login screen, PDF
  // agreements, receipts, SMS sign-off) instead of the old hardcoded "STN
  // Micro Credit" strings — this is what lets the exact same codebase be
  // deployed for a different organization and show that org's own name and
  // logo, with each org's own admin able to change it via Settings without
  // anyone touching code or redeploying. Deliberately a single-row table
  // (one org per database, per the database-per-tenant architecture) rather
  // than keyed by org id — there's only ever one organization's worth of
  // branding in any given deployment's database.
  if (!(await db.schema.hasTable('org_settings'))) {
    await db.schema.createTable('org_settings', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.string('org_name', 150).notNullable().defaultTo('My Organization');
      table.text('logo_url').nullable();
      // Loan reference numbers (e.g. "SC-007") are generated from this
      // prefix at creation time — see src/app/api/loans/route.js. Kept
      // short and uppercase since it's printed on every receipt/agreement.
      table.string('reference_prefix', 10).notNullable().defaultTo('LN');
      table.timestamps(true, true);
    });
    console.log("Migration: created table 'org_settings'.");
    // Seed the single settings row with a neutral placeholder — the org's
    // own admin sets their real name/logo via Settings -> Organization
    // after first login (or the platform owner sets it directly during
    // onboarding, same as any other seed step).
    await db('org_settings').insert({ org_name: 'My Organization' });
    console.log('Migration: seeded default org_settings row.');
  }
  await addColumnIfMissing('org_settings', 'reference_prefix', (t) => t.string('reference_prefix', 10).notNullable().defaultTo('LN'));
  // Backs the "Overdue Reminder Threshold (days)" admin setting — previously
  // stored in localStorage only, so it never actually controlled anything
  // server-side despite the name implying it gated the reminder cron. Read
  // by runPaymentReminders() (src/lib/services/reminders.js) as "how many
  // days BEFORE the next interest due date to send a reminder" — a
  // proactive heads-up, not a reactive "you're already late" nag. Default
  // of 1 means "the day before it's due".
  await addColumnIfMissing('org_settings', 'overdue_reminder_threshold_days', (t) => t.integer('overdue_reminder_threshold_days').notNullable().defaultTo(1));

  // Public, unauthenticated borrower-intake submissions — a shareable link
  // (see /apply, a standalone public page) an agent can send ahead of a
  // visit, or have a literate family member fill in on the borrower's
  // behalf, instead of the agent re-typing everything into the Give Loan
  // wizard on the spot. Deliberately NOT auto-created as a loan — every
  // submission lands here first for an admin/agent to review (see
  // /api/borrower-intakes) before "Create Loan from This" pre-fills the
  // real wizard with it. No NIC/address-proof photo fields — those still
  // get attached inside the wizard when the intake is converted, keeping
  // this public endpoint simple and not a place to upload sensitive ID
  // photos before anyone's reviewed the submission at all.
  if (!(await db.schema.hasTable('borrower_intakes'))) {
    await db.schema.createTable('borrower_intakes', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.string('status', 20).notNullable().defaultTo('pending'); // 'pending', 'converted', 'dismissed'
      table.string('borrower_name', 100).notNullable();
      table.string('borrower_phone', 20).notNullable();
      table.text('borrower_address').nullable();
      table.date('date_of_birth').nullable();
      table.string('nic_number', 50).nullable();
      table.text('loan_purpose').nullable();
      table.integer('dependents_count').nullable();
      table.decimal('monthly_income', 15, 2).nullable();
      table.string('spouse_name', 100).nullable();
      table.string('spouse_nic', 50).nullable();
      table.string('spouse_occupation', 100).nullable();
      table.text('notes').nullable(); // free text from whoever filled the form in — context for the reviewer
      table.string('submitted_language', 10).nullable(); // 'en' or 'ta' — which toggle they used, in case wording needs revisiting later
      table.uuid('converted_loan_id').references('id').inTable('loans').onDelete('SET NULL').nullable();
      table.uuid('reviewed_by').references('id').inTable('users').onDelete('SET NULL').nullable();
      table.timestamp('reviewed_at').nullable();
      table.timestamps(true, true);
    });
    console.log("Migration: created table 'borrower_intakes'.");
  }

  // Multi-photo NIC + Photo Proof — previously one base64 data URL each for
  // borrower and guarantor ("Address Proof" renamed to the more general
  // "Photo Proof" since it's used for any ID/photo evidence, not just a
  // utility bill). Up to 4 photos per field now, stored as a jsonb array of
  // data URLs (same base64-in-DB pattern, just plural). The old singular
  // *_url columns are kept as-is (not dropped) so existing photos already on
  // disk aren't lost; they're backfilled into the new array columns below
  // and the app now reads/writes the array columns exclusively going
  // forward.
  await addColumnIfMissing('loans', 'nic_photo_urls', (t) => t.jsonb('nic_photo_urls').nullable());
  await addColumnIfMissing('loans', 'photo_proof_urls', (t) => t.jsonb('photo_proof_urls').nullable());
  await addColumnIfMissing('guarantors', 'nic_photo_urls', (t) => t.jsonb('nic_photo_urls').nullable());
  await addColumnIfMissing('guarantors', 'photo_proof_urls', (t) => t.jsonb('photo_proof_urls').nullable());

  await db.raw(`
    UPDATE loans SET nic_photo_urls = jsonb_build_array(nic_photo_url)
    WHERE nic_photo_url IS NOT NULL AND (nic_photo_urls IS NULL OR nic_photo_urls = '[]'::jsonb)
  `);
  await db.raw(`
    UPDATE loans SET photo_proof_urls = jsonb_build_array(address_proof_url)
    WHERE address_proof_url IS NOT NULL AND (photo_proof_urls IS NULL OR photo_proof_urls = '[]'::jsonb)
  `);
  await db.raw(`
    UPDATE guarantors SET nic_photo_urls = jsonb_build_array(nic_photo_url)
    WHERE nic_photo_url IS NOT NULL AND (nic_photo_urls IS NULL OR nic_photo_urls = '[]'::jsonb)
  `);
  await db.raw(`
    UPDATE guarantors SET photo_proof_urls = jsonb_build_array(address_proof_url)
    WHERE address_proof_url IS NOT NULL AND (photo_proof_urls IS NULL OR photo_proof_urls = '[]'::jsonb)
  `);
  console.log('Migration: backfilled nic_photo_urls/photo_proof_urls arrays from legacy singular columns.');

  // Extends the public /apply intake form to collect nearly everything the
  // staff Give Loan wizard does (KYC photos + up to 2 guarantors), so an
  // agent converting a submission has less left to re-collect in person.
  // Deliberately still optional at the DB/API level, matching this table's
  // existing lenient-validation philosophy — the review queue is where gaps
  // get caught, not this form.
  await addColumnIfMissing('borrower_intakes', 'nic_photo_urls', (t) => t.jsonb('nic_photo_urls').nullable());
  await addColumnIfMissing('borrower_intakes', 'photo_proof_urls', (t) => t.jsonb('photo_proof_urls').nullable());
  // Up to 2 guarantors, each shaped like a loan guarantor form (full_name,
  // nic_number, address, phone, nic_photo_urls, photo_proof_urls, and the
  // same income/expense/legal-status fields the wizard collects) but stored
  // as one jsonb array here rather than real `guarantors` table rows, since
  // nothing is a real loan yet — handleConvertIntakeToLoan reshapes this
  // into the wizard's guarantorForms state when a submission is converted.
  await addColumnIfMissing('borrower_intakes', 'guarantors', (t) => t.jsonb('guarantors').nullable());

  // OTP-based self-service password reset — replaces the old flow where
  // "Forgot Password" emailed/texted a full temporary password directly.
  // Only a short-lived, single-use OTP code is ever sent now; the user
  // still has to choose their own new password to actually complete a
  // reset (see /api/auth/forgot-password and /api/auth/reset-password).
  // The OTP itself is stored hashed (bcrypt), same as a real password,
  // not in plaintext.
  await addColumnIfMissing('users', 'reset_otp_hash', (t) => t.text('reset_otp_hash').nullable());
  await addColumnIfMissing('users', 'reset_otp_expires_at', (t) => t.timestamp('reset_otp_expires_at').nullable());
  await addColumnIfMissing('users', 'reset_otp_attempts', (t) => t.integer('reset_otp_attempts').notNullable().defaultTo(0));
  // Drives both the server-side resend cooldown (a client can't just hammer
  // the endpoint to re-send OTPs) and lets the UI restore its countdown on
  // page refresh instead of resetting to 0.
  await addColumnIfMissing('users', 'reset_otp_last_sent_at', (t) => t.timestamp('reset_otp_last_sent_at').nullable());

  // Records every SMS send attempt (OTP, loan/payment/reminder alerts —
  // everything routed through sendNotification in notification.js), so a
  // silent delivery failure is visible in the app instead of only
  // discoverable by reading server logs. This exists because of a real
  // incident: Sabesh Capital's Text.lk credentials were never configured,
  // so every "forgot password" OTP silently fell back to a console-only
  // mock for weeks before anyone noticed — nothing in the UI showed that.
  if (!(await db.schema.hasTable('sms_logs'))) {
    await db.schema.createTable('sms_logs', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.string('recipient_name', 150);
      table.string('phone', 30).notNullable();
      table.string('role', 30);
      // 'sent' = real Text.lk API call succeeded; 'mocked' = TEXTLK_API_TOKEN/
      // TEXTLK_SENDER_ID aren't configured so nothing left this server at
      // all; 'failed' = a real send was attempted and Text.lk rejected it
      // or the request errored.
      table.string('status', 20).notNullable();
      table.text('message').notNullable();
      table.text('error').nullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.index(['created_at']);
      table.index(['status']);
    });
  }

  // ---------------------------------------------------------------------
  // Pawn Portal (Sabesh): vehicle / gold-jewellery pawn loans. Entirely
  // separate tables and ledger accounts from the cash-loan system above —
  // a pawn loan is secured by a physical item and has its own lifecycle
  // (active -> redeemed -> item returned, or active -> forfeited), so it
  // doesn't share the loans/transactions/ledger_entries tables.
  // Defaults to false: nobody gets Pawn access until an admin turns it on.
  // ---------------------------------------------------------------------
  await addColumnIfMissing('users', 'pawn_access', (t) => t.boolean('pawn_access').notNullable().defaultTo(false));

  if (!(await db.schema.hasTable('pawn_loans'))) {
    await db.schema.createTable('pawn_loans', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.string('reference_number', 30).unique().notNullable(); // e.g. PWN-001
      // Customer details (mirrors the paper pawn form)
      table.string('customer_name', 150).notNullable();
      table.string('father_husband_name', 150).nullable();
      table.text('address').nullable();
      table.string('nic_number', 20).notNullable();
      table.string('mobile', 30).notNullable();
      table.string('occupation', 150).nullable();
      table.decimal('monthly_income', 15, 2).nullable();
      table.string('reference_name', 150).nullable();
      table.string('reference_phone', 30).nullable();
      // Pawned item
      table.string('pawn_type', 10).notNullable(); // 'vehicle' | 'gold'
      table.text('item_description').notNullable();
      table.string('make_model', 150).nullable();          // vehicles
      table.string('registration_serial', 100).nullable(); // vehicles: reg no, gold: serial/tag
      table.decimal('gold_weight_grams', 10, 3).nullable(); // gold only
      table.string('gold_karat', 10).nullable();            // gold only, e.g. "22K"
      table.decimal('estimated_value', 15, 2).notNullable(); // free-typed by the admin
      table.string('storage_location', 150).nullable();
      table.jsonb('item_photo_urls').nullable();
      table.jsonb('document_photo_urls').nullable();
      // Loan terms — interest works exactly like the cash loans (monthly
      // rate; daily = /30, weekly = /4 — see calculateInterestPerPeriod)
      table.decimal('principal_amount', 15, 2).notNullable();
      table.decimal('interest_rate', 7, 3).notNullable(); // monthly %
      table.string('interest_type', 10).notNullable().defaultTo('monthly'); // daily | weekly | monthly
      table.integer('period_months').notNullable().defaultTo(1);
      table.decimal('principal_outstanding', 15, 2).notNullable();
      table.decimal('interest_balance', 15, 2).notNullable().defaultTo(0);
      table.timestamp('start_date').notNullable().defaultTo(db.fn.now());
      table.timestamp('due_date').notNullable();
      table.timestamp('next_accrual_date').nullable();
      table.timestamp('last_accrual_date').nullable();
      table.string('status', 20).notNullable().defaultTo('active'); // active | redeemed | forfeited
      table.timestamp('item_returned_at').nullable();
      table.timestamp('forfeited_at').nullable();
      table.text('forfeit_reason').nullable();
      table.decimal('auction_proceeds', 15, 2).nullable();
      table.decimal('surplus_due', 15, 2).nullable();
      table.text('notes').nullable();
      table.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
      table.index('status');
      table.index('due_date');
      table.index('next_accrual_date');
    });
    console.log("Migration: created table 'pawn_loans'.");
  }

  if (!(await db.schema.hasTable('pawn_payments'))) {
    await db.schema.createTable('pawn_payments', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.uuid('pawn_loan_id').notNullable().references('id').inTable('pawn_loans').onDelete('RESTRICT');
      table.decimal('amount', 15, 2).notNullable();
      table.string('payment_type', 20).notNullable(); // 'interest' | 'principal'
      table.timestamp('payment_date').defaultTo(db.fn.now());
      table.text('notes').nullable();
      table.string('payment_method', 50).defaultTo('cash');
      table.uuid('received_by').references('id').inTable('users').onDelete('SET NULL');
      table.string('idempotency_key', 255).unique().notNullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.index('pawn_loan_id');
    });
    console.log("Migration: created table 'pawn_payments'.");
  }

  if (!(await db.schema.hasTable('pawn_interest_accruals'))) {
    await db.schema.createTable('pawn_interest_accruals', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.uuid('pawn_loan_id').notNullable().references('id').inTable('pawn_loans').onDelete('RESTRICT');
      table.decimal('amount_accrued', 15, 2).notNullable();
      table.text('calculation_log').notNullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.index('pawn_loan_id');
    });
    console.log("Migration: created table 'pawn_interest_accruals'.");
  }

  // The pawn portal's own double-entry ledger (accounts: pawn_cash,
  // pawn_receivable_principal, pawn_receivable_interest, pawn_interest_revenue,
  // pawn_written_off_expense, pawn_surplus_payable).
  if (!(await db.schema.hasTable('pawn_ledger_entries'))) {
    await db.schema.createTable('pawn_ledger_entries', (table) => {
      table.uuid('id').primary().defaultTo(db.fn.uuid());
      table.uuid('pawn_loan_id').references('id').inTable('pawn_loans').onDelete('RESTRICT');
      table.uuid('pawn_payment_id').references('id').inTable('pawn_payments').onDelete('SET NULL');
      table.string('account', 40).notNullable();
      table.string('type', 10).notNullable(); // 'debit' | 'credit'
      table.decimal('amount', 15, 2).notNullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.index('pawn_loan_id');
      table.index('account');
    });
    console.log("Migration: created table 'pawn_ledger_entries'.");
  }
}

async function createSchemaAndSeed() {
  console.log('Initializing database schema...');

  await db.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(db.fn.uuid());
    table.string('name', 100).notNullable();
    table.string('email', 100).unique().nullable(); // legacy field, no longer used for login
    table.string('phone', 20).unique().notNullable();
    table.string('gender', 10).nullable();
    table.string('password_hash', 255).notNullable();
    table.string('role', 20).notNullable(); // 'admin', 'agent', 'borrower'
    table.boolean('is_active').defaultTo(true);
    table.boolean('must_change_password').defaultTo(false);
    table.integer('failed_login_attempts').defaultTo(0);
    table.timestamp('locked_until').nullable();
    table.timestamps(true, true);
  });

  await db.schema.createTable('loans', (table) => {
    table.uuid('id').primary().defaultTo(db.fn.uuid());
    table.uuid('borrower_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.uuid('lender_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.uuid('assigned_agent_id').references('id').inTable('users').onDelete('SET NULL');
    table.decimal('principal_amount', 15, 2).notNullable();
    table.decimal('interest_rate', 5, 2).notNullable();
    table.string('interest_type', 20).notNullable(); // 'daily', 'weekly', 'monthly'
    // Interest-only model: principal_outstanding only decreases via
    // principal payments (never grows from interest); interest_balance is
    // the running unpaid-interest amount, cleared by interest payments.
    table.decimal('principal_outstanding', 15, 2).notNullable();
    table.decimal('interest_balance', 15, 2).notNullable().defaultTo(0);
    table.string('status', 20).defaultTo('active'); // 'pending', 'active', 'fully_paid', 'defaulted', 'written_off', 'rejected'
    table.timestamp('last_accrual_date').defaultTo(db.fn.now());
    table.timestamp('next_accrual_date').notNullable();
    table.string('reference_number', 50).unique().nullable();
    table.string('nic_number', 50);
    table.text('nic_photo_url');
    table.text('address_proof_url');
    table.date('date_of_birth').nullable();
    table.text('borrower_address').nullable();
    table.text('default_reason').nullable();
    table.timestamp('defaulted_at').nullable();
    table.decimal('write_off_amount', 15, 2).nullable();
    table.text('write_off_reason').nullable();
    table.timestamp('written_off_at').nullable();
    table.uuid('approved_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('approved_at').nullable();
    table.text('loan_rejection_reason').nullable();
    table.timestamp('rejected_at').nullable();
    table.text('loan_purpose').nullable();
    table.integer('dependents_count').nullable();
    table.decimal('monthly_income', 15, 2).nullable();
    table.string('spouse_name', 150).nullable();
    table.string('spouse_nic', 50).nullable();
    table.string('spouse_occupation', 150).nullable();
    table.string('collection_mode', 30).notNullable().defaultTo('passbook');
    table.integer('duration_periods').nullable();
    table.timestamp('maturity_date').nullable();
    table.boolean('is_flat_installment').notNullable().defaultTo(false);
    table.decimal('daily_installment_amount', 15, 2).nullable();
    table.decimal('principal_per_day', 15, 2).nullable();
    table.decimal('interest_per_day', 15, 2).nullable();
    table.timestamps(true, true);

    table.index('borrower_id');
    table.index('assigned_agent_id');
    table.index(['status', 'next_accrual_date']);
  });

  await db.schema.createTable('transactions', (table) => {
    table.uuid('id').primary().defaultTo(db.fn.uuid());
    table.uuid('loan_id').notNullable().references('id').inTable('loans').onDelete('RESTRICT');
    table.uuid('agent_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.uuid('borrower_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.decimal('amount', 15, 2).notNullable();
    table.string('payment_type', 20).notNullable().defaultTo('principal'); // 'interest' or 'principal'
    table.timestamp('payment_date').defaultTo(db.fn.now());
    table.text('notes');
    table.text('proof_image_url');
    table.string('payment_method', 50).defaultTo('cash');
    table.string('idempotency_key', 255).unique().notNullable();
    table.decimal('principal_component', 15, 2).nullable();
    table.decimal('interest_component', 15, 2).nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());

    table.index('loan_id');
    table.index('agent_id');
    table.index('payment_date');
  });

  await db.schema.createTable('interest_accruals', (table) => {
    table.uuid('id').primary().defaultTo(db.fn.uuid());
    table.uuid('loan_id').notNullable().references('id').inTable('loans').onDelete('RESTRICT');
    table.decimal('amount_accrued', 15, 2).notNullable();
    table.text('calculation_log').notNullable();
    table.timestamp('created_at').defaultTo(db.fn.now());

    table.index('loan_id');
    table.index('created_at');
  });

  await db.schema.createTable('ledger_entries', (table) => {
    table.uuid('id').primary().defaultTo(db.fn.uuid());
    table.uuid('loan_id').references('id').inTable('loans').onDelete('SET NULL');
    table.uuid('transaction_id').references('id').inTable('transactions').onDelete('SET NULL');
    table.string('account', 30).notNullable(); // 'cash_agent', 'cash_office', 'loan_receivable_principal', 'loan_receivable_interest', 'interest_revenue', 'penalty_revenue', 'written_off_expense'
    table.string('type', 10).notNullable(); // 'debit', 'credit'
    table.decimal('amount', 15, 2).notNullable();
    table.timestamp('created_at').defaultTo(db.fn.now());

    table.index('loan_id');
  });

  await db.schema.createTable('audit_logs', (table) => {
    table.uuid('id').primary().defaultTo(db.fn.uuid());
    table.uuid('actor_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('action_type', 100).notNullable();
    table.text('description').notNullable();
    table.string('ip_address', 45);
    table.string('user_agent', 255);
    table.timestamp('created_at').defaultTo(db.fn.now());
  });

  await db.schema.createTable('remittances', (table) => {
    table.uuid('id').primary().defaultTo(db.fn.uuid());
    table.uuid('agent_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.decimal('amount', 15, 2).notNullable();
    table.text('notes');
    table.string('status', 20).notNullable().defaultTo('pending'); // 'pending', 'verified', 'rejected'
    table.uuid('verified_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('verified_at').nullable();
    table.text('rejection_reason').nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
  });

  await db.schema.createTable('guarantors', (table) => {
    table.uuid('id').primary().defaultTo(db.fn.uuid());
    table.uuid('loan_id').notNullable().references('id').inTable('loans').onDelete('CASCADE');
    table.string('full_name', 150).notNullable();
    table.string('nic_number', 50).notNullable();
    table.string('gender', 10);
    table.string('ethnicity', 100);
    table.date('date_of_birth');
    table.text('address').nullable();
    table.string('phone', 20).notNullable();
    table.string('email', 100);
    table.text('nic_photo_url');
    table.text('address_proof_url');
    table.boolean('protected_under_debt_act').defaultTo(false);
    table.boolean('has_pending_court_cases').defaultTo(false);
    table.decimal('monthly_income_business', 15, 2).defaultTo(0);
    table.decimal('monthly_income_agriculture', 15, 2).defaultTo(0);
    table.decimal('monthly_income_other', 15, 2).defaultTo(0);
    table.decimal('monthly_expense_food', 15, 2).defaultTo(0);
    table.decimal('monthly_expense_rent', 15, 2).defaultTo(0);
    table.decimal('monthly_expense_other', 15, 2).defaultTo(0);
    table.timestamp('created_at').defaultTo(db.fn.now());
  });

  await db.schema.createTable('daily_collections', (table) => {
    table.uuid('id').primary().defaultTo(db.fn.uuid());
    table.uuid('loan_id').notNullable().references('id').inTable('loans').onDelete('CASCADE');
    table.date('collection_date').notNullable();
    table.string('status', 20).notNullable(); // 'paid', 'partial', 'not_paid'
    table.decimal('amount', 15, 2).nullable();
    table.uuid('transaction_id').references('id').inTable('transactions').onDelete('SET NULL');
    table.uuid('marked_by').references('id').inTable('users').onDelete('SET NULL');
    table.text('notes').nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
    table.unique(['loan_id', 'collection_date']);
  });

  console.log('Database tables created successfully.');
  console.log('Seeding initial demo data...');

  const users = [
    { id: 'a1111111-1111-1111-1111-111111111111', name: 'Lender Admin', phone: '0774048194', password_hash: HASHED_PASSWORD, role: 'admin' },
    { id: 'a2222222-2222-2222-2222-222222222222', name: 'Agent Amal', phone: '+94777654321', password_hash: HASHED_PASSWORD, role: 'agent' },
    { id: 'a3333333-3333-3333-3333-333333333333', name: 'Borrower Bandara', phone: '+94778888888', password_hash: HASHED_PASSWORD, role: 'borrower' },
    { id: 'a4444444-4444-4444-4444-444444444444', name: 'Borrower Chandana', phone: '+94779999999', password_hash: HASHED_PASSWORD, role: 'borrower' }
  ];
  await db('users').insert(users);
  console.log('Users seeded (login by phone, password: password123). Primary admin phone: 0774048194.');

  const baseDate = new Date();
  const lastAccrualDaily = new Date(baseDate.getTime() - 24 * 60 * 60 * 1000);
  const nextAccrualDaily = new Date(baseDate.getTime() + 24 * 60 * 60 * 1000);
  const lastAccrualWeekly = new Date(baseDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const nextAccrualWeekly = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);

  await db('loans').insert([
    {
      id: 'b1111111-1111-1111-1111-111111111111',
      borrower_id: 'a3333333-3333-3333-3333-333333333333',
      lender_id: 'a1111111-1111-1111-1111-111111111111',
      assigned_agent_id: 'a2222222-2222-2222-2222-222222222222',
      principal_amount: 100000.00, interest_rate: 2.00, interest_type: 'daily',
      // 100k principal untouched by interest; borrower has paid off 2,000 of
      // the 2,000 interest accrued so far, and made a 15,000 principal payment.
      principal_outstanding: 85000.00, interest_balance: 0.00, status: 'active',
      last_accrual_date: lastAccrualDaily, next_accrual_date: nextAccrualDaily,
      created_at: new Date(baseDate.getTime() - 3 * 24 * 60 * 60 * 1000)
    },
    {
      id: 'b2222222-2222-2222-2222-222222222222',
      borrower_id: 'a4444444-4444-4444-4444-444444444444',
      lender_id: 'a1111111-1111-1111-1111-111111111111',
      assigned_agent_id: 'a2222222-2222-2222-2222-222222222222',
      principal_amount: 250000.00, interest_rate: 5.00, interest_type: 'weekly',
      // 250k principal untouched; the 12,500 interest accrued so far is
      // still unpaid.
      principal_outstanding: 250000.00, interest_balance: 12500.00, status: 'active',
      last_accrual_date: lastAccrualWeekly, next_accrual_date: nextAccrualWeekly,
      created_at: new Date(baseDate.getTime() - 10 * 24 * 60 * 60 * 1000)
    }
  ]);
  console.log('Loans seeded.');

  await db('transactions').insert([
    {
      id: 'c1111111-1111-1111-1111-111111111111',
      loan_id: 'b1111111-1111-1111-1111-111111111111',
      agent_id: 'a2222222-2222-2222-2222-222222222222',
      borrower_id: 'a3333333-3333-3333-3333-333333333333',
      amount: 15000.00,
      payment_type: 'principal',
      payment_date: new Date(baseDate.getTime() - 12 * 60 * 60 * 1000),
      notes: 'Partial principal repayment in cash',
      idempotency_key: 'idemp_sample_123',
      created_at: new Date(baseDate.getTime() - 12 * 60 * 60 * 1000)
    },
    {
      id: 'c2222222-2222-2222-2222-222222222222',
      loan_id: 'b1111111-1111-1111-1111-111111111111',
      agent_id: 'a2222222-2222-2222-2222-222222222222',
      borrower_id: 'a3333333-3333-3333-3333-333333333333',
      amount: 2000.00,
      payment_type: 'interest',
      payment_date: lastAccrualDaily,
      notes: 'Daily interest payment',
      idempotency_key: 'idemp_sample_124',
      created_at: lastAccrualDaily
    }
  ]);
  console.log('Transactions seeded.');

  await db('interest_accruals').insert([
    { loan_id: 'b1111111-1111-1111-1111-111111111111', amount_accrued: 2000.00, calculation_log: 'Principal: 100000.00 | Rate: 2% | Type: daily', created_at: lastAccrualDaily },
    { loan_id: 'b2222222-2222-2222-2222-222222222222', amount_accrued: 12500.00, calculation_log: 'Principal: 250000.00 | Rate: 5% | Type: weekly', created_at: lastAccrualWeekly }
  ]);
  console.log('Interest accruals seeded.');

  await db('ledger_entries').insert([
    { loan_id: 'b1111111-1111-1111-1111-111111111111', account: 'loan_receivable_principal', type: 'debit', amount: 100000.00, created_at: new Date(baseDate.getTime() - 3 * 24 * 60 * 60 * 1000) },
    { loan_id: 'b1111111-1111-1111-1111-111111111111', account: 'cash_office', type: 'credit', amount: 100000.00, created_at: new Date(baseDate.getTime() - 3 * 24 * 60 * 60 * 1000) },
    { loan_id: 'b1111111-1111-1111-1111-111111111111', account: 'loan_receivable_interest', type: 'debit', amount: 2000.00, created_at: lastAccrualDaily },
    { loan_id: 'b1111111-1111-1111-1111-111111111111', account: 'interest_revenue', type: 'credit', amount: 2000.00, created_at: lastAccrualDaily },
    { loan_id: 'b1111111-1111-1111-1111-111111111111', transaction_id: 'c2222222-2222-2222-2222-222222222222', account: 'cash_agent', type: 'debit', amount: 2000.00, created_at: lastAccrualDaily },
    { loan_id: 'b1111111-1111-1111-1111-111111111111', transaction_id: 'c2222222-2222-2222-2222-222222222222', account: 'loan_receivable_interest', type: 'credit', amount: 2000.00, created_at: lastAccrualDaily },
    { loan_id: 'b1111111-1111-1111-1111-111111111111', transaction_id: 'c1111111-1111-1111-1111-111111111111', account: 'cash_agent', type: 'debit', amount: 15000.00, created_at: new Date(baseDate.getTime() - 12 * 60 * 60 * 1000) },
    { loan_id: 'b1111111-1111-1111-1111-111111111111', transaction_id: 'c1111111-1111-1111-1111-111111111111', account: 'loan_receivable_principal', type: 'credit', amount: 15000.00, created_at: new Date(baseDate.getTime() - 12 * 60 * 60 * 1000) },
    { loan_id: 'b2222222-2222-2222-2222-222222222222', account: 'loan_receivable_principal', type: 'debit', amount: 250000.00, created_at: new Date(baseDate.getTime() - 10 * 24 * 60 * 60 * 1000) },
    { loan_id: 'b2222222-2222-2222-2222-222222222222', account: 'cash_office', type: 'credit', amount: 250000.00, created_at: new Date(baseDate.getTime() - 10 * 24 * 60 * 60 * 1000) },
    { loan_id: 'b2222222-2222-2222-2222-222222222222', account: 'loan_receivable_interest', type: 'debit', amount: 12500.00, created_at: lastAccrualWeekly },
    { loan_id: 'b2222222-2222-2222-2222-222222222222', account: 'interest_revenue', type: 'credit', amount: 12500.00, created_at: lastAccrualWeekly }
  ]);
  console.log('Ledger entries seeded.');

  await db('audit_logs').insert([
    { actor_id: 'a1111111-1111-1111-1111-111111111111', action_type: 'CREATE_LOAN', description: 'Lender Admin created a Daily loan of 100,000 LKR for Borrower Bandara.', created_at: new Date(baseDate.getTime() - 3 * 24 * 60 * 60 * 1000) },
    { actor_id: 'a1111111-1111-1111-1111-111111111111', action_type: 'CREATE_LOAN', description: 'Lender Admin created a Weekly loan of 250,000 LKR for Borrower Chandana.', created_at: new Date(baseDate.getTime() - 10 * 24 * 60 * 60 * 1000) },
    { actor_id: 'a2222222-2222-2222-2222-222222222222', action_type: 'RECORD_PAYMENT', description: 'Agent Amal collected 15,000 LKR principal repayment for Borrower Bandara.', created_at: new Date(baseDate.getTime() - 12 * 60 * 60 * 1000) }
  ]);
  console.log('Audit logs seeded.');
}

async function main() {
  const isFreshInstall = !(await db.schema.hasTable('users'));

  if (isFreshInstall) {
    await createSchemaAndSeed();
  } else {
    console.log('Tables already exist — checking for incremental schema migrations...');
  }

  await runIncrementalMigrations();
  console.log('Migration complete.');
}

main()
  .then(() => db.destroy())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    db.destroy().finally(() => process.exit(1));
  });
