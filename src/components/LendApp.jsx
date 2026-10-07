'use client';

import React, { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/apiClient.js';
import { submitPaymentOrQueue, syncQueuedPayments, getQueueCount, onQueueChanged } from '@/lib/offlineQueue.js';
import { TypedDateInput } from './TypedDateInput.jsx';
import PawnPortal from './PawnPortal.jsx';
import { Gem, Pencil, Undo2 } from 'lucide-react';
import {
  Home, Banknote, ClipboardList, Users, Landmark, KeyRound, LogOut,
  ArrowLeft, ArrowRight, ScrollText, Check, X, Phone, IdCard, ShieldCheck,
  Printer, FileText, TrendingUp, Bell, BarChart3, Zap, AlertTriangle,
  Briefcase, Truck, BookOpen, ArrowDown, User, Settings, Ban, Receipt,
  Search, CreditCard, Smartphone, PiggyBank, MessageSquare, UserPlus, Trash2, ClipboardCheck,
  CircleCheck, CircleAlert, RefreshCcw, Download, ChevronRight, Calendar,
  Plus, ThumbsUp, ThumbsDown, Clock, Filter, LayoutGrid, Camera
} from 'lucide-react';

// Delays reflecting a fast-changing value until it's stopped changing for
// `delayMs` — used to debounce search inputs that trigger a server request
// per change, so typing "Bandara" fires one request instead of seven.
function useDebouncedValue(value, delayMs = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// Closes a modal/popup on the Escape key — the one dismiss gesture users
// reach for by habit that none of this app's dialogs supported (closing
// otherwise needed a click on the backdrop or an explicit Cancel button).
// `isOpen` gates whether the listener is even attached, so closed modals
// don't all compete to handle the same keypress; call this once per modal,
// unconditionally on every render, same as any other hook.
function useEscapeToClose(isOpen, onClose) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
}

// Traps Tab/Shift+Tab focus within a dialog while it's open, moves focus
// into it as soon as it opens, and restores focus to whatever triggered it
// once it closes — the three behaviors the ARIA Authoring Practices Dialog
// pattern expects. None of this app's modals did any of it before:
// Escape closed them (see useEscapeToClose above), but Tab could still
// reach controls visually hidden behind the overlay, and closing one
// silently dropped focus to <body>.
//
// `containerRef` must point at the dialog's outermost element, which also
// needs tabIndex={-1} so it's a valid focus target on the rare dialog with
// no focusable children of its own. Call this once per modal,
// unconditionally on every render, same as useEscapeToClose.
function useFocusTrap(isOpen, containerRef) {
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const container = containerRef.current;
    const previouslyFocused = document.activeElement;
    const focusableSelector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(container.querySelectorAll(focusableSelector)).filter((el) => el.offsetParent !== null);

    const focusable = getFocusable();
    (focusable[0] || container).focus({ preventScroll: true });

    function handleKeyDown(e) {
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [isOpen, containerRef]);
}

// Lets a clickable <div> (the dashboard's menu-card tiles, styled as big
// touch-friendly buttons but not actual <button> elements) respond to the
// keyboard the same way a real button would — Enter or Space activates it.
// Without this, the cards were only reachable by mouse/touch: a
// keyboard-only or switch-device user tabbing through them (once
// role="button" tabIndex={0} makes them focusable at all) could focus a
// card but never activate it.
function handleCardKeyDown(e, action) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    action();
  }
}

// Shared CSV download helper — builds a file client-side from a header row
// and an array of row-arrays, then triggers a browser download via a
// throwaway object URL (no server round-trip, works from data already in
// memory). Escapes each cell per RFC 4180: wrap in quotes whenever the
// value contains a comma, quote, or newline, and double up any internal
// quotes — several real fields here (agent/borrower names, free-text
// Notes) can legitimately contain commas, which would otherwise silently
// shift every column after them in the exported file.
//
// This was previously called in three places (Loan Directory, Remittances/
// Cash Handovers, Payment History) without ever being defined anywhere in
// the codebase — every "Export CSV" button in the app was throwing
// `ReferenceError: downloadCsv is not defined` on click and silently
// failing (browsers don't surface an unhandled click-handler exception to
// the user, it just does nothing).
function downloadCsv(filename, headers, rows) {
  const escapeCell = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [headers, ...rows]
    .map(row => row.map(escapeCell).join(','))
    .join('\r\n');
  // Leading BOM so Excel (still the realistic destination for most of
  // these files) detects UTF-8 instead of misreading Sinhala/Tamil names
  // or the "Rs." / non-ASCII characters that show up in notes fields.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Threshold for the manual "Active Loans Overdue" review table in Reminder
// Settings — a plain "what's overdue right now" display filter (days since
// last accrual), kept separate from overdueDaysThreshold below, which
// configures the automated before-due-date reminder cron and means
// something different ("days before due", not "days since last accrual").
const MANUAL_OVERDUE_REVIEW_DAYS = 3;

// Display-only: whether a loan's outstanding balance should be shown as
// one combined "Total Outstanding" figure instead of split Principal/
// Interest. Originally this was just flat-installment loans (the bundled
// principal+interest model), but the same complaint came back for plain
// Daily-collection loans too — the split reads as confusing accounting
// detail to a daily-collection borrower/agent regardless of which of the
// two "Daily" models the loan actually is. Deliberately NOT used for
// functional logic (payment-type routing, interest accrual eligibility,
// due-amount calculation) — those still key off the real is_flat_installment
// flag, since plain Daily loans genuinely do accrue interest incrementally
// and take separate Interest/Principal payments; only the balance DISPLAY
// changes here.
const showsUnifiedOutstanding = (loan) => !!loan.is_flat_installment || loan.interest_type === 'daily';

// Mirrors the same constant enforced server-side in /api/loans and
// /api/loans/[id]/guarantor — see the comment there. Client-side copy is
// display-only (the live NIC-lookup warning); the server is what actually
// blocks it.
const MAX_ACTIVE_GUARANTEED_LOANS = 3;

// Which portals a user can open. One portal -> straight in; several -> chooser.
// Pawn is admin-only and off by default (users.pawn_access).
function portalHomeFor(u) {
  const portals = [];
  if (u.finance_access) portals.push('dashboard');
  if (u.ticket_access) portals.push('ticket-dashboard');
  if (u.role === 'admin' && u.pawn_access) portals.push('pawn-dashboard');
  return portals.length === 1 ? portals[0] : 'portal';
}
// "YYYY-MM-DD" in the browser's local time (what a <date> value should be).
function toDateInputValue(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function canSwitchPortals(u) {
  return [u.finance_access !== false, u.ticket_access !== false, u.role === 'admin' && u.pawn_access === true].filter(Boolean).length > 1;
}

export default function LendApp() {
  const [token, setToken] = useState(localStorage.getItem('lend_token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('lend_user')));
  // Every top-level destination reachable from the nav/bottom-bar that
  // fetches its own data from scratch off of token/user alone — safe to
  // restore after a reload. Excludes only views tied to a specific
  // selected record (a specific loan's statement — 'ledger',
  // 'passbook-details' — or a specific ticket) since those depend on
  // other in-memory state (selectedLoanId, loanStatement...) that reload
  // can't recover; landing back on one of those with nothing behind it
  // would show a stuck spinner instead of actually helping. This
  // originally only listed dashboard/portal/ticket-dashboard, which
  // meant refreshing from any actual work screen — Check Loans, Record
  // Payment, Agent Route, Interest Center, Payment History, Audit Log —
  // dropped straight back to the dashboard.
  const RESTORABLE_VIEWS = [
    'dashboard', 'portal', 'ticket-dashboard', 'pawn-dashboard',
    'create-loan', 'next-day-tasklist', 'record-payment',
    'loans', 'agents', 'interest-center', 'payment-history',
    'audit-log', 'admin-tools', 'borrower-intakes'
  ];
  const [view, setView] = useState(() => {
    if (typeof window !== 'undefined') {
      const storedUser = localStorage.getItem('lend_user');
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser);
          if (parsed) {
            const savedView = sessionStorage.getItem('lend_view');
            if (savedView && RESTORABLE_VIEWS.includes(savedView)) {
              return savedView;
            }
            return portalHomeFor(parsed);
          }
        } catch {
          return 'dashboard';
        }
      }
    }
    return 'dashboard';
  });
  const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'loans', 'agents'
  // An agent's day-to-day work happens almost entirely inside view ===
  // 'dashboard' via this sub-view (agents don't switch top-level views the
  // way admins do — see the agentSubView nav buttons) — so this needs the
  // same reload-survival treatment as `view` above, or an agent
  // refreshing/resuming the PWA mid-collection-round would land back on
  // the generic 'collect' tab every time.
  const [agentSubView, setAgentSubView] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('lend_agent_subview');
      if (saved && ['collect', 'next-day-tasklist', 'record-payment', 'history', 'remit'].includes(saved)) {
        return saved;
      }
    }
    return 'record-payment';
  }); // 'collect' (single payment), 'next-day-tasklist', 'record-payment' (route sheet — the agent's default, fastest daily tool), 'history', 'remit'
  const [agentCustomerTab, setAgentCustomerTab] = useState('active'); // 'active', 'defaulted', 'closed'
  const [agentCollectMobileTab, setAgentCollectMobileTab] = useState('form'); // mobile-only: 'form', 'customers'
  const [agentCustomerSearch, setAgentCustomerSearch] = useState('');
  const [passbookMobileTab, setPassbookMobileTab] = useState('record'); // mobile-only: 'record', 'activity', 'receipts', 'accruals'
  const [showMoreMenu, setShowMoreMenu] = useState(false); // mobile-only: bottom-sheet for admin destinations that don't have their own bottom-nav slot
  // Pending Borrower Intake submissions (see /apply) awaiting review — just
  // the count, for the "Applications" nav badge; the full list is fetched
  // by the Applications view itself when it's actually open.
  const [pendingIntakeCount, setPendingIntakeCount] = useState(0);
  // Payments recorded with no connection, saved locally until they can
  // sync — see src/lib/offlineQueue.js. Initialized from localStorage
  // (not 0) so a reload while offline still shows the true pending count
  // instead of losing it until the next mutation.
  const [pendingSyncCount, setPendingSyncCount] = useState(() => (typeof window !== 'undefined' ? getQueueCount() : 0));
  // This organization's own branding (name + logo), read from this
  // deployment's own database via GET /api/settings — public/unauthenticated
  // since the login screen needs it before anyone's signed in. Replaces the
  // old hardcoded "STN Micro Credit" strings throughout the app.
  const [orgSettings, setOrgSettings] = useState({ org_name: '', logo_url: null });
  const [orgSettingsForm, setOrgSettingsForm] = useState({ org_name: '', logo_url: '' });
  const [orgSettingsError, setOrgSettingsError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Real-time toast notifications list
  const [toastAlerts, setToastAlerts] = useState([]);

  // Data storage
  const [adminData, setAdminData] = useState(null);
  const [agentData, setAgentData] = useState(null);
  const [borrowersList, setBorrowersList] = useState([]);
  const [agentsList, setAgentsList] = useState([]);
  const [selectedLoanId, setSelectedLoanId] = useState(null);
  const [loanStatement, setLoanStatement] = useState(null);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [showLoanAgreement, setShowLoanAgreement] = useState(false);
  const [downloadingAgreement, setDownloadingAgreement] = useState(false);
  const [backfillDate, setBackfillDate] = useState('');

  // Admin: Cash & Tools view data (users, remittances, ledger report)
  const [adminToolsTab, setAdminToolsTab] = useState('cash'); // 'cash', 'ledger', 'users'
  const [adminUsers, setAdminUsers] = useState([]);
  const [userRoleFilter, setUserRoleFilter] = useState('all'); // 'all', 'admin', 'agent', 'borrower'
  const [userSearchTerm, setUserSearchTerm] = useState('');
  // Cash Handovers (admin verification queue) — fetches every remittance
  // ever submitted with no server-side limit, so this grows unbounded over
  // time; defaults to 'pending' since that's the actual actionable queue,
  // not the full history.
  const [remittanceStatusFilter, setRemittanceStatusFilter] = useState('pending');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState({ name: '', phone: '', email: '', role: 'agent', password: '', finance_access: true, ticket_access: true, pawn_access: false });
  const [remittances, setRemittances] = useState([]);
  const [ledgerReport, setLedgerReport] = useState(null);
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [cashReconciliation, setCashReconciliation] = useState(null);

  // Ticket (Chit Fund) states
  const [ticketsList, setTicketsList] = useState([]);
  const [selectedTicketIdState, setSelectedTicketIdState] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMembers, setTicketMembers] = useState([]);
  const [ticketAuctions, setTicketAuctions] = useState([]);
  const [ticketPayments, setTicketPayments] = useState([]);
  const [activeTicketTab, setActiveTicketTab] = useState('auction'); // 'auction', 'members', 'history'
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const [newTicketForm, setNewTicketForm] = useState({ name: '', total_value: '', member_count: '', start_date: '', host_fee_type: 'percentage', host_fee_value: '', starting_round: '' });
  const [newMemberForm, setNewMemberForm] = useState({ name: '', phone: '' });
  const [memberAddMode, setMemberAddMode] = useState('single'); // 'single' or 'bulk'
  const [bulkMemberText, setBulkMemberText] = useState('');
  const [bulkAddingMembers, setBulkAddingMembers] = useState(false);
  const [auctionForm, setAuctionForm] = useState({ bid_amount: '', winner_member_id: '', auction_date: new Date().toISOString().slice(0, 10), next_round_date: '' });
  const [ticketPaymentFilterRound, setTicketPaymentFilterRound] = useState('');
  const [editTicketForm, setEditTicketForm] = useState(null); // null = closed
  const [editMemberForm, setEditMemberForm] = useState(null); // null = closed: { id, name, phone }
  const [editRoundForm, setEditRoundForm] = useState(null); // null = closed: { id, round_number, auction_date, winner_member_id }
  const [ticketDialogError, setTicketDialogError] = useState('');
  const [assigningWinnerFor, setAssigningWinnerFor] = useState(null); // auction id currently being edited, or null
  const [assignWinnerMemberId, setAssignWinnerMemberId] = useState('');

  // Agent: cash remittance submission form
  const [remittanceForm, setRemittanceForm] = useState({ amount: '', notes: '' });

  // Change password & settings modal (all roles)
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('profile');
  const [profileForm, setProfileForm] = useState({ name: '', phone: '', email: '' });
  const [settingsError, setSettingsError] = useState('');
  const [collectionSummaryMode, setCollectionSummaryMode] = useState('today'); // 'today' or 'all-time'

  // Admin: loan edit/default/penalty controls on the statement view
  const [loanEditForm, setLoanEditForm] = useState({ interest_rate: '', assigned_agent_id: '' });
  const [defaultReason, setDefaultReason] = useState('');
  const [penaltyForm, setPenaltyForm] = useState({ amount: '', reason: '' });
  // Delete Loan — for a mistaken/test entry only (see handleDeleteLoan);
  // password re-entry is the confirmation, not another window.confirm.
  const [showDeleteLoanModal, setShowDeleteLoanModal] = useState(false);
  const [deleteLoanForm, setDeleteLoanForm] = useState({ reason: '', password: '' });

  // Generic replacement for window.prompt/window.confirm — one reusable
  // modal for every "confirm this", "give me a reason", or "enter an
  // amount" action in the app (reinstate, extend term, write off, reject,
  // approve, mark daily collection, record principal payment, remove
  // guarantor, delete ticket group, delete user, reject a cash handover).
  // A dozen near-identical bespoke modals would just be noise; one dialog
  // styled like the rest of the app, driven by a small field spec, covers
  // all of them — and unlike window.prompt/confirm, it's actually usable
  // on mobile (no native browser chrome) and closes on Escape.
  const [actionModal, setActionModal] = useState(null); // { title, message, danger, fields, confirmLabel, onConfirm }
  const [actionModalValues, setActionModalValues] = useState({});
  const [actionModalError, setActionModalError] = useState('');
  const [actionModalSubmitting, setActionModalSubmitting] = useState(false);

  const openActionModal = (config) => {
    setActionModal(config);
    const initial = {};
    (config.fields || []).forEach(f => { initial[f.key] = f.initialValue ?? ''; });
    setActionModalValues(initial);
    setActionModalError('');
    setActionModalSubmitting(false);
  };
  const closeActionModal = () => {
    setActionModal(null);
    setActionModalValues({});
    setActionModalError('');
    setActionModalSubmitting(false);
  };
  const handleActionModalConfirm = async () => {
    if (!actionModal) return;
    for (const f of actionModal.fields || []) {
      const val = actionModalValues[f.key];
      if (f.required && (val === undefined || val === null || String(val).trim() === '')) {
        setActionModalError(`${f.label} is required.`);
        return;
      }
      if (f.type === 'number' && String(val).trim() !== '' && (isNaN(parseFloat(val)) || parseFloat(val) <= 0)) {
        setActionModalError(`${f.label} must be a positive number.`);
        return;
      }
      if (f.matchValue !== undefined && String(val).trim() !== f.matchValue) {
        setActionModalError('That didn\'t match — check and try again.');
        return;
      }
    }
    setActionModalSubmitting(true);
    setActionModalError('');
    try {
      await actionModal.onConfirm(actionModalValues);
      closeActionModal();
    } catch (err) {
      // Shown inside the modal itself, same reasoning as Delete Loan's own
      // error handling — a wrong value or server rejection shouldn't close
      // the dialog out from under the admin.
      setActionModalError(err.message || 'Something went wrong.');
      setActionModalSubmitting(false);
    }
  };

  // Configurable Overdue Reminder Days Threshold (default 3 days). Loaded
  // from and saved to org_settings (see the /settings fetch effect below
  // and handleUpdateOverdueThreshold) — this used to be localStorage-only,
  // which meant it never actually reached the server-side reminder cron
  // despite the UI implying it controlled when reminder SMS go out.
  const [overdueDaysThreshold, setOverdueDaysThreshold] = useState(3);

  const handleUpdateOverdueThreshold = async (newDays) => {
    const parsed = Math.max(1, parseInt(newDays, 10) || 3);
    setOverdueDaysThreshold(parsed); // optimistic — the input should feel responsive while typing
    try {
      await api.patch('/settings', { overdue_reminder_threshold_days: parsed });
      showToast(`Overdue alert threshold updated to ${parsed} days.`);
    } catch (err) {
      showToast(err.message || 'Could not save the overdue threshold.', 'error');
    }
  };

  // Form states
  // Restored from sessionStorage (never the password — only the phone
  // number, which isn't sensitive) so a page reload or a mobile PWA
  // getting suspended and reopened mid-login doesn't throw away what was
  // already typed.
  const [loginPhone, setLoginPhone] = useState(() => (typeof window !== 'undefined' && sessionStorage.getItem('lend_login_phone_draft')) || '');
  const [loginPassword, setLoginPassword] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  // 'phone' (enter phone, request OTP) -> 'otp' (enter code + new password).
  const [forgotStep, setForgotStep] = useState('phone');
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotMessage, setForgotMessage] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPasswordOtp, setNewPasswordOtp] = useState('');
  const [confirmPasswordOtp, setConfirmPasswordOtp] = useState('');
  // Seconds remaining before "Resend OTP" is clickable again — mirrors the
  // server-side per-account cooldown in /api/auth/forgot-password so the
  // button can't be spammed into re-sending SMS.
  const [resendCooldown, setResendCooldown] = useState(0);
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(s => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);
  const [newLoan, setNewLoan] = useState({
    borrower_name: '',
    borrower_phone: '',
    borrower_address: '',
    borrower_email: '',
    date_of_birth: '',
    principal_amount: '',
    interest_rate: '2.00',
    interest_type: 'daily',
    assigned_agent_id: '',
    nic_number: '',
    nic_photos: [],
    photo_proofs: [],
    collection_mode: 'open_ended',
    duration_periods: '',
    // Admin-only backdating — defaults to today; ignored server-side for
    // agent submissions (those go through approval, which always uses the
    // actual approval moment). See LOAN SCHEDULING DETAILS in step 3.
    disbursement_date: todayLocalDateStr(),
    // Set when this loan is being created from a Borrower Intake submission
    // (see /apply and the Applications review queue) — tells the backend
    // which pending intake to mark converted once the loan's created.
    source_intake_id: null
  });
  const [includeGuarantor, setIncludeGuarantor] = useState(false);
  // No photo_proofs field — guarantors only need a NIC Photo, not Photo
  // Proof (removed from both the internal wizard and the public /apply
  // form's guarantor section; see runGuarantorValidation).
  const emptyGuarantor = {
    full_name: '', nic_number: '', nic_photos: [],
    address: '', phone: '',
    protected_under_debt_act: false, has_pending_court_cases: false,
    monthly_income_business: '', monthly_income_agriculture: '', monthly_income_other: '',
    monthly_expense_food: '', monthly_expense_rent: '', monthly_expense_other: ''
  };
  // Starts with one guarantor form; more can be added manually up to
  // MAX_GUARANTORS_PER_LOAN (see handleAddGuarantorForm below).
  const [guarantorForms, setGuarantorForms] = useState([emptyGuarantor]);
  const [giveLoanStep, setGiveLoanStep] = useState(1);
  const [validationErrors, setValidationErrors] = useState({});
  const [ledgerTab, setLedgerTab] = useState('passbook');

  const clearFieldError = (field) => {
    if (validationErrors[field]) {
      setValidationErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }
  };

  // Editing/adding a guarantor on an EXISTING loan (loan statement page),
  // separate from the create-loan form above.
  const [showGuarantorEditor, setShowGuarantorEditor] = useState(false);
  const [guarantorEditForm, setGuarantorEditForm] = useState(emptyGuarantor);

  // Editing user details (Admin only)
  const [editingUser, setEditingUser] = useState(null);
  const [editUserForm, setEditUserForm] = useState({ name: '', phone: '', role: '', email: '', finance_access: true, ticket_access: true, pawn_access: false });

  // Borrower profile details are collected for every loan now (not
  // optional) — loan purpose and monthly income are required; spouse
  // details stay optional since not every borrower has a spouse.
  const emptyBorrowerProfile = {
    loan_purpose: '', monthly_income: '',
    spouse_name: '', spouse_nic: '', spouse_occupation: ''
  };
  const [borrowerProfileForm, setBorrowerProfileForm] = useState(emptyBorrowerProfile);

  // Up to this many guarantor forms per loan — previously the count was
  // inferred from "Number of Dependents" (one guarantor form per
  // dependent), but that field was dropped, so it's now just a manual
  // add/remove via the buttons in the guarantor step (see handleAddGuarantorForm
  // / handleRemoveGuarantorForm below).
  const MAX_GUARANTORS_PER_LOAN = 3;

  // Collection payment form
  const [paymentForm, setPaymentForm] = useState({
    loan_id: '',
    payment_type: 'interest',
    amount: '',
    notes: '',
    proof_image: '',
    payment_method: 'cash',
    idempotency_key: ''
  });

  const [ledgerPaymentForm, setLedgerPaymentForm] = useState({
    payment_type: 'interest',
    amount: '',
    notes: '',
    proof_image: '',
    payment_method: 'cash',
    idempotency_key: ''
  });

  // Listen to expired tokens
  useEffect(() => {
    const handleAuthExpired = () => {
      setToken(null);
      setUser(null);
      setError('Session expired. Please log in again.');
    };
    window.addEventListener('auth-expired', handleAuthExpired);
    return () => window.removeEventListener('auth-expired', handleAuthExpired);
  }, []);

  // Remember the current top-level screen (see RESTORABLE_VIEWS above) so
  // a reload — or a mobile PWA getting suspended in the background and
  // reopened — lands back where the user actually was, not a generic
  // default. Only writes for the safe/self-sufficient views; entering a
  // deeper view (a specific loan, mid-wizard, etc.) leaves the last safe
  // value in place rather than saving something reload can't recover.
  useEffect(() => {
    if (RESTORABLE_VIEWS.includes(view)) {
      sessionStorage.setItem('lend_view', view);
    }
  }, [view]);

  // Same reasoning as the view-persistence effect above, for the agent
  // sub-navigation (see agentSubView's own comment).
  useEffect(() => {
    sessionStorage.setItem('lend_agent_subview', agentSubView);
  }, [agentSubView]);

  // Remember the in-progress login phone number (never the password) so
  // typing it and then getting interrupted — switching apps, the PWA
  // getting backgrounded and reloaded — doesn't throw it away.
  useEffect(() => {
    if (loginPhone) {
      sessionStorage.setItem('lend_login_phone_draft', loginPhone);
    } else {
      sessionStorage.removeItem('lend_login_phone_draft');
    }
  }, [loginPhone]);

  // Load this organization's own branding — runs unconditionally (not
  // gated on login) since the login screen itself needs to show the org's
  // name/logo before anyone's authenticated.
  useEffect(() => {
    api.get('/settings')
      .then(res => {
        setOrgSettings({ org_name: res.org_name || '', logo_url: res.logo_url || null });
        // Org-wide now (used by the real reminder cron server-side too —
        // see reminders.js) rather than a per-browser localStorage value
        // that never actually controlled anything outside this tab.
        if (res.overdue_reminder_threshold_days) {
          setOverdueDaysThreshold(res.overdue_reminder_threshold_days);
        }
      })
      .catch(() => {}); // Falls back to the empty default — never blocks the app on this.
  }, []);

  // Fetch dashboards based on user role
  useEffect(() => {
    if (!token || !user) return;
    fetchDashboardData();
    if (user.ticket_access) {
      fetchTickets();
    }
    if (user.role === 'admin' || user.role === 'agent') {
      api.get('/borrower-intakes?status=pending')
        .then(res => setPendingIntakeCount(Array.isArray(res) ? res.length : 0))
        .catch(() => {});
    }
  }, [token, user]);

  // Offline payment queue — sync attempts fire on login, on the browser's
  // 'online' event (network actually came back), whenever the queue itself
  // changes, and on demand from the header's "Sync Now" button. A sync
  // that isn't actually online yet is harmless: syncQueuedPayments just
  // leaves everything queued and returns immediately on the first network
  // error, so there's no harm calling this speculatively.
  const attemptQueueSync = async () => {
    const { synced, failed } = await syncQueuedPayments();
    if (synced.length > 0) {
      const total = synced.reduce((s, item) => s + (parseFloat(item.payload?.amount) || 0), 0);
      showToast(`Back online — synced ${synced.length} queued payment${synced.length === 1 ? '' : 's'} (LKR ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).`);
      fetchDashboardData();
    }
    if (failed.length > 0) {
      // Couldn't succeed even once back online (e.g. the loan's state
      // changed since it was queued) — surfaced distinctly so it isn't
      // silently lost; the entry has already been removed from the queue
      // (see syncQueuedPayments) since retrying it would never work.
      failed.forEach(({ item, message }) => {
        showToast(`A queued payment for ${item.meta?.borrowerName || 'a borrower'} (LKR ${item.payload?.amount || '?'}) could not be synced: ${message}`, 'error');
      });
    }
  };

  useEffect(() => {
    if (!token || !user) return;
    attemptQueueSync();
    const unsubscribe = onQueueChanged(setPendingSyncCount);
    window.addEventListener('online', attemptQueueSync);
    return () => {
      unsubscribe();
      window.removeEventListener('online', attemptQueueSync);
    };
  }, [token, user]);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError('');
    try {
      if (user.role === 'admin') {
        const data = await api.get('/dashboard/admin');
        setAdminData(data);
        const bList = await api.get('/users/borrowers');
        setBorrowersList(bList);
        const aList = await api.get('/users/agents');
        setAgentsList(aList);
      } else if (user.role === 'agent') {
        const data = await api.get('/dashboard/agent');
        setAgentData(data);
        const remits = await api.get('/remittances');
        setRemittances(remits);
        // Pre-fill idempotency key
        resetPaymentForm(data.assignedLoans?.[0]?.id || '');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Admin: load Users / Remittances / Ledger report for the Cash & Tools view
  const openAdminTools = async () => {
    setView('admin-tools');
    setSelectedLoanId(null);
    setLoanStatement(null);
    setLoading(true);
    setError('');
    try {
      const [users, remits, ledger, recon] = await Promise.all([
        api.get('/users?role=admin,agent,borrower'),
        api.get('/remittances'),
        api.get('/reports/ledger'),
        api.get('/cash-reconciliation')
      ]);
      setAdminUsers(users);
      setRemittances(remits);
      setLedgerReport(ledger);
      setCashReconciliation(recon);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshAdminTools = async () => {
    try {
      const [users, remits, ledger, recon] = await Promise.all([
        api.get('/users?role=admin,agent,borrower'),
        api.get('/remittances'),
        api.get('/reports/ledger'),
        api.get('/cash-reconciliation')
      ]);
      setAdminUsers(users);
      setRemittances(remits);
      setLedgerReport(ledger);
      setCashReconciliation(recon);
    } catch (err) {
      setError(err.message);
    }
  };

  // Re-fetch just the ledger report with the selected date range — the API
  // has always supported from/to, but the UI never exposed it, so admins
  // could only ever see an all-time trial balance, never a monthly one.
  const handleFetchLedgerReport = async (overrideFrom, overrideTo) => {
    const from = overrideFrom !== undefined ? overrideFrom : ledgerFrom;
    const to = overrideTo !== undefined ? overrideTo : ledgerTo;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const query = params.toString();
      const ledger = await api.get(`/reports/ledger${query ? `?${query}` : ''}`);
      setLedgerReport(ledger);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRemittance = async (id) => {
    setLoading(true);
    setError('');
    try {
      await api.patch(`/remittances/${id}/verify`, {});
      showToast('Cash handover verified.');
      refreshAdminTools();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRejectRemittance = (id) => {
    openActionModal({
      title: 'Reject Cash Handover',
      fields: [{ key: 'reason', label: 'Reason', type: 'text', required: true, placeholder: 'e.g. cash never arrived' }],
      confirmLabel: 'Reject Handover',
      danger: true,
      onConfirm: async (values) => {
        await api.patch(`/remittances/${id}/reject`, { reason: values.reason });
        showToast('Cash handover rejected — reversed onto the agent\'s outstanding cash-in-hand.');
        refreshAdminTools();
      },
    });
  };

  const handleToggleUserStatus = async (targetUser) => {
    setLoading(true);
    setError('');
    try {
      await api.patch(`/users/${targetUser.id}/status`, { is_active: !targetUser.is_active });
      showToast(`${targetUser.name} ${targetUser.is_active ? 'deactivated' : 'activated'}.`);
      refreshAdminTools();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetUserPassword = async (targetUser) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.post(`/users/${targetUser.id}/reset-password`, {});
      showToast(result.message || `Verification code sent to ${targetUser.name}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartEditUser = (targetUser) => {
    setEditingUser(targetUser);
    setEditUserForm({
      name: targetUser.name || '',
      phone: targetUser.phone || '',
      role: targetUser.role || '',
      email: targetUser.email || '',
      finance_access: targetUser.finance_access !== false,
      ticket_access: targetUser.ticket_access !== false,
      pawn_access: targetUser.pawn_access === true
    });
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editingUser) return;
    setLoading(true);
    setError('');
    try {
      await api.patch(`/users/${editingUser.id}`, {
        name: editUserForm.name,
        phone: editUserForm.phone,
        role: editUserForm.role,
        email: editUserForm.email || '',
        finance_access: !!editUserForm.finance_access,
        ticket_access: !!editUserForm.ticket_access,
        pawn_access: editUserForm.role === 'admin' && !!editUserForm.pawn_access
      });
      showToast(`User ${editUserForm.name} updated successfully.`);
      setEditingUser(null);
      refreshAdminTools();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.post('/auth/register', {
        name: newUserForm.name,
        phone: newUserForm.phone,
        email: newUserForm.email || undefined,
        role: newUserForm.role,
        password: newUserForm.password || undefined,
        finance_access: !!newUserForm.finance_access,
        ticket_access: !!newUserForm.ticket_access,
        pawn_access: newUserForm.role === 'admin' && !!newUserForm.pawn_access
      });
      showToast(
        result.temporaryPassword
          ? `${newUserForm.name} added as ${newUserForm.role}. Temporary password: ${result.temporaryPassword}`
          : `${newUserForm.name} added as ${newUserForm.role}.`
      );
      setNewUserForm({ name: '', phone: '', email: '', role: 'agent', password: '', finance_access: true, ticket_access: true, pawn_access: false });
      setShowAddUser(false);
      refreshAdminTools();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = (targetUser) => {
    openActionModal({
      title: `Delete ${targetUser.name}`,
      message: 'This permanently removes this account and cannot be undone. Users with loan/payment history can\'t be deleted this way — deactivate them instead to preserve the audit trail.',
      fields: [{ key: 'password', label: 'Confirm Your Password', type: 'password', required: true }],
      confirmLabel: 'Delete Permanently',
      danger: true,
      onConfirm: async (values) => {
        // Password travels in the request body, not a URL query string —
        // a query string can end up in server access logs.
        await api.delete(`/users/${targetUser.id}`, { password: values.password });
        showToast(`${targetUser.name} deleted.`);
        refreshAdminTools();
      },
    });
  };

  const downloadLedgerCsv = () => {
    if (!ledgerReport) return;
    const header = 'Account,Debit,Credit,Net\n';
    const rows = ledgerReport.accounts.map(a => `${a.label},${a.debit.toFixed(2)},${a.credit.toFixed(2)},${a.net.toFixed(2)}`).join('\n');
    const footer = `\nTotals,${ledgerReport.totals.debit.toFixed(2)},${ledgerReport.totals.credit.toFixed(2)},`;
    const blob = new Blob([header + rows + footer], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ledger-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadRemittancesCsv = () => {
    if (!remittances.length) return;
    downloadCsv(
      `cash-handovers-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Date', 'Agent', 'Amount', 'Status', 'Notes', 'Verified/Rejected By', 'Verified/Rejected At'],
      remittances.map(r => [
        new Date(r.created_at).toLocaleString(),
        r.agent_name,
        parseFloat(r.amount).toFixed(2),
        r.status,
        r.notes || '',
        r.verified_by_name || '',
        r.verified_at ? new Date(r.verified_at).toLocaleString() : ''
      ])
    );
  };

  // Agent: submit a cash handover to the office
  const handleSubmitRemittance = async (e) => {
    e.preventDefault();
    if (!remittanceForm.amount || parseFloat(remittanceForm.amount) <= 0) {
      setError('Please enter a valid cash handover amount.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/remittances', { amount: parseFloat(remittanceForm.amount), notes: remittanceForm.notes });
      showToast(`LKR ${parseFloat(remittanceForm.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} cash handover submitted to the office.`);
      setRemittanceForm({ amount: '', notes: '' });
      fetchDashboardData();
      const remits = await api.get('/remittances');
      setRemittances(remits);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Any role: change own password
  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setError('New password and confirmation do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/change-password', {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password
      });
      showToast('Password changed successfully.');
      setShowChangePassword(false);
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      if (user?.mustChangePassword) {
        const updatedUser = { ...user, mustChangePassword: false };
        localStorage.setItem('lend_user', JSON.stringify(updatedUser));
        setUser(updatedUser);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Open settings panel prefilled with profile info
  const handleOpenSettings = () => {
    setProfileForm({
      name: user?.name || '',
      phone: user?.phone || '',
      email: user?.email || ''
    });
    setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
    setSettingsError('');
    setSettingsTab('profile');
    setShowSettings(true);
  };

  // Submit profile self-updates
  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setSettingsError('');
    setLoading(true);
    try {
      await api.patch(`/users/${user.id}`, profileForm);
      const updatedUser = { ...user, ...profileForm };
      localStorage.setItem('lend_user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      showToast('Profile updated successfully!');
      setShowSettings(false);
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Admin: edit mutable loan terms from the statement view
  const handleUpdateLoan = async (e) => {
    e.preventDefault();
    if (!selectedLoanId) return;
    setLoading(true);
    setError('');
    try {
      const payload = {};
      if (loanEditForm.interest_rate !== '') payload.interest_rate = parseFloat(loanEditForm.interest_rate);
      if (loanEditForm.assigned_agent_id !== '') payload.assigned_agent_id = loanEditForm.assigned_agent_id;
      await api.patch(`/loans/${selectedLoanId}`, payload);
      showToast('Loan updated successfully.');
      setLoanEditForm({ interest_rate: '', assigned_agent_id: '' });
      viewStatement(selectedLoanId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Admin: mark a loan defaulted
  const handleMarkDefaulted = async () => {
    if (!selectedLoanId) return;
    if (!defaultReason.trim()) {
      setError('Please provide a reason before marking this loan as defaulted.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post(`/loans/${selectedLoanId}/default`, { reason: defaultReason });
      showToast('Loan marked as defaulted.');
      setDefaultReason('');
      viewStatement(selectedLoanId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Admin: reinstate a defaulted loan back to active so payments can be collected again
  const handleReinstateLoan = () => {
    if (!selectedLoanId) return;
    openActionModal({
      title: 'Reinstate Loan',
      message: 'Reinstate this loan to active? Payments can be collected on it again.',
      confirmLabel: 'Reinstate',
      onConfirm: async () => {
        await api.post(`/loans/${selectedLoanId}/reinstate`, {});
        showToast('Loan reinstated to active.');
        viewStatement(selectedLoanId);
      },
    });
  };

  // Admin: give a struggling fixed-term loan more calendar time to finish
  // paying, WITHOUT changing what's collected per period — deliberately
  // the narrowest form of "restructuring" (see extend-term route.js for
  // why this specific lever is safe). Only meaningful for a loan that has
  // a fixed term at all (collection_mode 'fixed_term'); open-ended loans
  // have nothing to extend.
  const handleExtendLoanTerm = () => {
    if (!loanStatement?.loan) return;
    const loan = loanStatement.loan;
    const periodUnit = loan.interest_type === 'daily' ? 'day' : loan.interest_type === 'weekly' ? 'week' : 'month';
    const periodAdj = periodUnit === 'day' ? 'daily' : periodUnit === 'week' ? 'weekly' : 'monthly';
    openActionModal({
      title: 'Extend Loan Term',
      message: `Current term: ${loan.duration_periods} ${periodUnit}s. The ${periodAdj} payment amount will NOT change — this only gives more time. The borrower will be notified by SMS.`,
      fields: [
        { key: 'extendBy', label: `Extend by how many more ${periodUnit}s?`, type: 'number', required: true },
        { key: 'reason', label: 'Reason', type: 'text', required: true },
      ],
      confirmLabel: 'Extend Term',
      onConfirm: async (values) => {
        const extendBy = parseInt(values.extendBy, 10);
        if (!Number.isInteger(extendBy) || extendBy <= 0) {
          throw new Error('Enter a positive whole number of periods to extend by.');
        }
        await api.post(`/loans/${loan.id}/extend-term`, { additionalPeriods: extendBy, reason: values.reason });
        showToast('Loan term extended.');
        viewStatement(loan.id);
      },
    });
  };

  // Admin: write off a loan's remaining balance as unrecoverable bad debt
  const handleWriteOffLoan = () => {
    if (!selectedLoanId) return;
    openActionModal({
      title: 'Write Off Loan',
      message: 'This permanently zeroes the loan\'s outstanding balance and posts it to the ledger as bad debt.',
      fields: [{ key: 'reason', label: 'Reason', type: 'text', required: true }],
      confirmLabel: 'Write Off',
      danger: true,
      onConfirm: async (values) => {
        await api.post(`/loans/${selectedLoanId}/write-off`, { reason: values.reason });
        showToast('Loan written off as bad debt.');
        viewStatement(selectedLoanId);
      },
    });
  };

  // Admin: permanently delete a mistaken/test loan. Only ever succeeds for
  // a loan with zero real payments/accruals — the server enforces that
  // authoritatively (and the DB itself would refuse it regardless, see the
  // DELETE handler's comment) — this is for the "oops, wrong loan, never
  // should have been created" case, not a way to close out a real account.
  const handleDeleteLoan = async () => {
    if (!selectedLoanId) return;
    if (!deleteLoanForm.reason.trim()) {
      showToast('A reason is required to delete this loan.', 'error');
      return;
    }
    if (!deleteLoanForm.password) {
      showToast('Enter your password to confirm.', 'error');
      return;
    }
    setLoading(true);
    try {
      await api.delete(`/loans/${selectedLoanId}`, { reason: deleteLoanForm.reason, password: deleteLoanForm.password });
      showToast('Loan permanently deleted.');
      setShowDeleteLoanModal(false);
      setDeleteLoanForm({ reason: '', password: '' });
      setSelectedLoanId(null);
      setLoanStatement(null);
      setView('loans');
      fetchDashboardData();
    } catch (err) {
      // Deliberately shown in the modal itself (not the page-level error
      // banner) so a wrong password or "still has activity" rejection
      // doesn't close the confirmation dialog out from under the admin.
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Downloads a formatted Loan Agreement PDF (with the company logo) for
  // the currently open loan statement — runs client-side via jsPDF, no
  // server round trip needed. jsPDF (and this generator module) are loaded
  // on demand via a dynamic import rather than a top-level import — jsPDF
  // is a sizeable library that was previously bundled into every single
  // page load of the app, even though downloading an agreement is a rare
  // action relative to total page views. Splitting it into its own
  // on-demand chunk keeps it out of the initial JS payload everyone else
  // pays for.
  const handleDownloadAgreement = async () => {
    if (!loanStatement) return;
    setDownloadingAgreement(true);
    try {
      const { downloadLoanAgreementPdf } = await import('@/lib/generateLoanAgreementPdf.js');
      await downloadLoanAgreementPdf(loanStatement, orgSettings);
    } catch (err) {
      console.error('PDF generation failed:', err);
      showToast('Could not generate the PDF. Please try again.');
    } finally {
      setDownloadingAgreement(false);
    }
  };

  // Admin: approve an agent-submitted loan application — this is the moment
  // it actually disburses.
  const handleApproveLoan = () => {
    if (!selectedLoanId) return;
    openActionModal({
      title: 'Approve Loan Application',
      message: 'This disburses the cash and starts interest accruing.',
      confirmLabel: 'Approve & Disburse',
      onConfirm: async () => {
        await api.post(`/loans/${selectedLoanId}/approve`, {});
        showToast('Loan application approved and disbursed.');
        viewStatement(selectedLoanId);
      },
    });
  };

  // Admin: reject an agent-submitted loan application — nothing was ever
  // disbursed, so this just closes out the application.
  const handleRejectLoan = () => {
    if (!selectedLoanId) return;
    openActionModal({
      title: 'Reject Loan Application',
      fields: [{ key: 'reason', label: 'Reason', type: 'text', required: true }],
      confirmLabel: 'Reject Application',
      danger: true,
      onConfirm: async (values) => {
        await api.post(`/loans/${selectedLoanId}/reject`, { reason: values.reason });
        showToast('Loan application rejected.');
        viewStatement(selectedLoanId);
      },
    });
  };

  // Admin: apply a manual penalty / late fee
  const handleApplyPenalty = async (e) => {
    e.preventDefault();
    if (!selectedLoanId) return;
    if (!penaltyForm.amount || parseFloat(penaltyForm.amount) <= 0) {
      setError('Please enter a valid penalty amount.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post(`/loans/${selectedLoanId}/apply-penalty`, {
        amount: parseFloat(penaltyForm.amount),
        reason: penaltyForm.reason
      });
      showToast('Penalty applied and posted to the ledger.');
      setPenaltyForm({ amount: '', reason: '' });
      viewStatement(selectedLoanId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Quick daily collection mark — mirrors the physical passbook's per-day
  // paid/not-paid checkbox. 'paid'/'partial' actually records a real
  // interest payment (asks for the amount); 'not_paid' is just a log entry.
  const markDailyCollectionDirect = async (loanId, status, date) => {
    setLoading(true);
    setError('');
    try {
      await api.post(`/loans/${loanId}/daily-collection`, { date, status, amount: null });
      showToast('Marked as not paid today.');
      fetchDashboardData();
      if (loanStatement?.loan?.id === loanId) viewStatement(loanId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkDailyCollection = (loanId, status, date = null) => {
    if (status === 'paid' || status === 'partial') {
      openActionModal({
        title: status === 'partial' ? 'Mark Partial Payment' : 'Mark Full Payment',
        fields: [{ key: 'amount', label: 'Amount Collected (LKR)', type: 'number', required: true }],
        confirmLabel: 'Save',
        onConfirm: async (values) => {
          const amount = parseFloat(values.amount);
          await api.post(`/loans/${loanId}/daily-collection`, { date, status, amount });
          showToast(`Marked as ${status} — LKR ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} recorded.`);
          fetchDashboardData();
          if (loanStatement?.loan?.id === loanId) viewStatement(loanId);
        },
      });
      return;
    }
    // 'not_paid' needs no amount — just a log entry, so it skips the modal
    // entirely and records directly, same as before.
    markDailyCollectionDirect(loanId, status, date);
  };

  // Admin-only quick action: record a principal payment directly against a
  // loan (e.g. self-collected loans with no assigned agent). Interest
  // payments already have a dedicated flow via the Daily Collection Tracker
  // above; this covers the one gap that's left now that borrowers no longer
  // have self-service login to submit their own principal payments.
  const handleRecordPrincipalPayment = (loanId) => {
    openActionModal({
      title: 'Record Principal Payment',
      fields: [{ key: 'amount', label: 'Principal Amount Received (LKR)', type: 'number', required: true }],
      confirmLabel: 'Record Payment',
      onConfirm: async (values) => {
        const amount = parseFloat(values.amount);
        const result = await submitPaymentOrQueue('/payments', {
          loan_id: loanId,
          amount,
          payment_type: 'principal',
          payment_method: 'cash',
          idempotency_key: 'idemp_principal_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now()
        }, { amount, kind: 'Principal' });

        if (result.queued) {
          showToast(`No connection — principal payment of LKR ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} saved and will sync automatically once you're back online.`, 'info');
        } else {
          showToast(`Principal payment of LKR ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} recorded.`);
          if (loanStatement?.loan?.id === loanId) viewStatement(loanId);
        }
      },
    });
  };

  const resetPaymentForm = (loanId) => {
    setPaymentForm({
      loan_id: loanId || '',
      payment_type: 'interest',
      amount: '',
      notes: '',
      proof_image: '',
      payment_method: 'cash',
      idempotency_key: 'idemp_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now()
    });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api.post('/auth/login', { phone: loginPhone, password: loginPassword });
      localStorage.setItem('lend_token', data.token);
      localStorage.setItem('lend_user', JSON.stringify(data.user));
      sessionStorage.removeItem('lend_login_phone_draft');
      setToken(data.token);
      setUser(data.user);
      const home = portalHomeFor(data.user);
      setView(home);
      if (home === 'ticket-dashboard') fetchTickets();
      // Deliberately no toast here — landing on the dashboard/portal IS the
      // confirmation that login worked. A popup on top of that just adds
      // noise the user has to dismiss every single time they sign in.
      if (data.user.mustChangePassword) {
        setShowChangePassword(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 1: request an OTP for the entered phone number.
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setForgotMessage('');
    try {
      const data = await api.post('/auth/forgot-password', { identifier: forgotIdentifier });
      setForgotMessage(data.message);
      setForgotStep('otp');
      setResendCooldown(Math.ceil((data.cooldownMs || 60000) / 1000));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // "Resend OTP" — same endpoint as the initial send, just re-triggered;
  // disabled client-side while resendCooldown > 0 (the button itself is
  // also disabled in the JSX, this guards direct calls too).
  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.post('/auth/forgot-password', { identifier: forgotIdentifier });
      setForgotMessage('A new code has been sent.');
      setResendCooldown(Math.ceil((data.cooldownMs || 60000) / 1000));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: verify the OTP and set a new password, in one request.
  const handleResetPasswordWithOtp = async (e) => {
    e.preventDefault();
    setError('');
    if (newPasswordOtp !== confirmPasswordOtp) {
      setError('Passwords do not match.');
      return;
    }
    if (newPasswordOtp.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }
    setLoading(true);
    try {
      const data = await api.post('/auth/reset-password', { identifier: forgotIdentifier, otp: otpCode, new_password: newPasswordOtp });
      setLoginPhone(forgotIdentifier);
      setLoginPassword('');
      setShowForgotPassword(false);
      setForgotStep('phone');
      setForgotIdentifier('');
      setForgotMessage('');
      setOtpCode('');
      setNewPasswordOtp('');
      setConfirmPasswordOtp('');
      setResendCooldown(0);
      showToast(data.message || 'Password updated. You can now log in.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBackToPhoneStep = () => {
    setForgotStep('phone');
    setError('');
    setForgotMessage('');
    setOtpCode('');
    setNewPasswordOtp('');
    setConfirmPasswordOtp('');
    setResendCooldown(0);
  };

  const handleLogout = () => {
    localStorage.removeItem('lend_token');
    localStorage.removeItem('lend_user');
    sessionStorage.removeItem('lend_view');
    sessionStorage.removeItem('lend_agent_subview');
    setToken(null);
    setUser(null);
    setAdminData(null);
    setAgentData(null);
    showToast('Logged out successfully.');
  };

  // --- TICKET PORTAL API CALLS ---
  const fetchTickets = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/tickets');
      setTicketsList(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTicketDetails = async (ticketId) => {
    setLoading(true);
    setError('');
    try {
      const ticket = await api.get(`/tickets/${ticketId}`);
      setSelectedTicket(ticket);
      
      const members = await api.get(`/tickets/${ticketId}/members`);
      setTicketMembers(members);

      const auctions = await api.get(`/tickets/${ticketId}/auctions`);
      setTicketAuctions(auctions);

      // Reset forms
      setNewMemberForm({ name: '', phone: '' });
      setAuctionForm({
        bid_amount: '',
        winner_member_id: '',
        auction_date: new Date().toISOString().slice(0, 10),
        next_round_date: ''
      });

      // Fetch payments for current active round (or last round)
      const targetRound = ticket.status === 'completed' 
        ? ticket.member_count 
        : Math.max(1, ticket.current_round - 1);
      
      setTicketPaymentFilterRound(String(targetRound));
      
      if (auctions.length > 0) {
        const payments = await api.get(`/tickets/${ticketId}/payments?round=${targetRound}`);
        setTicketPayments(payments);
      } else {
        setTicketPayments([]);
      }
      
      setSelectedTicketIdState(ticketId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFetchTicketPaymentsByRound = async (roundVal) => {
    if (!selectedTicketIdState) return;
    try {
      const payments = await api.get(`/tickets/${selectedTicketIdState}/payments?round=${roundVal}`);
      setTicketPayments(payments);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateTicket = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/tickets', {
        name: newTicketForm.name,
        total_value: parseFloat(newTicketForm.total_value),
        member_count: parseInt(newTicketForm.member_count, 10),
        start_date: newTicketForm.start_date,
        host_fee_type: newTicketForm.host_fee_type,
        host_fee_value: parseFloat(newTicketForm.host_fee_value),
        starting_round: newTicketForm.starting_round || undefined
      });
      showToast(`Ticket group '${newTicketForm.name}' created successfully.`);
      setShowCreateTicket(false);
      setNewTicketForm({ name: '', total_value: '', member_count: '', start_date: '', host_fee_type: 'percentage', host_fee_value: '', starting_round: '' });
      fetchTickets();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Permanently removes the group and its whole history (members, every
  // round, all payment tracking — see the DELETE route's comment). Typing
  // the exact name is a higher bar than a plain confirm dialog on purpose,
  // given how much gets wiped in one action.
  const handleDeleteTicket = (ticket, e, { leaveDetail = false } = {}) => {
    if (e) e.stopPropagation();
    openActionModal({
      title: `Delete '${ticket.name}'`,
      message: 'This permanently deletes every member, every round\'s auction record, and all payment tracking for this group. This cannot be undone.',
      fields: [{ key: 'confirmName', label: `Type "${ticket.name}" exactly to confirm`, type: 'text', required: true, matchValue: ticket.name }],
      confirmLabel: 'Delete Group',
      danger: true,
      onConfirm: async () => {
        await api.delete(`/tickets/${ticket.id}`);
        showToast(`'${ticket.name}' deleted.`);
        if (leaveDetail) { setSelectedTicketIdState(null); setSelectedTicket(null); }
        fetchTickets();
      },
    });
  };

  // ---- Chit group / member / round editing ----
  const openEditTicket = (ticket, e) => {
    if (e) e.stopPropagation();
    setTicketDialogError('');
    setEditTicketForm({
      id: ticket.id,
      name: ticket.name || '',
      total_value: String(parseFloat(ticket.total_value)),
      member_count: String(ticket.member_count),
      start_date: toDateInputValue(ticket.start_date),
      next_round_date: toDateInputValue(ticket.next_round_date),
      host_fee_type: ticket.host_fee_type,
      host_fee_value: String(parseFloat(ticket.host_fee_value)),
      roundsRun: ticket.status === 'completed' ? ticket.member_count : ticket.current_round - 1,
      rosterCount: selectedTicket && selectedTicket.id === ticket.id ? ticketMembers.length : null
    });
  };

  const handleSaveTicketEdit = async (e) => {
    e.preventDefault();
    const f = editTicketForm;
    if (!f) return;
    setTicketDialogError('');
    setLoading(true);
    try {
      const updated = await api.patch(`/tickets/${f.id}`, {
        name: f.name,
        total_value: parseFloat(f.total_value),
        member_count: parseInt(f.member_count, 10),
        start_date: f.start_date || undefined,
        next_round_date: f.next_round_date || null,
        host_fee_type: f.host_fee_type,
        host_fee_value: parseFloat(f.host_fee_value)
      });
      showToast(`'${updated.name}' updated.`);
      setEditTicketForm(null);
      if (selectedTicketIdState === f.id) fetchTicketDetails(f.id); else fetchTickets();
    } catch (err) {
      setTicketDialogError(err.message === 'Nothing to update.' ? 'No changes to save.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  const openEditMember = (m) => {
    setTicketDialogError('');
    setEditMemberForm({ id: m.id, name: m.name || '', phone: m.phone || '' });
  };

  const handleSaveMemberEdit = async (e) => {
    e.preventDefault();
    const f = editMemberForm;
    if (!f || !selectedTicket) return;
    setTicketDialogError('');
    setLoading(true);
    try {
      await api.patch(`/tickets/${selectedTicket.id}/members/${f.id}`, { name: f.name, phone: f.phone });
      showToast(`Member '${f.name}' updated.`);
      setEditMemberForm(null);
      fetchTicketDetails(selectedTicket.id);
    } catch (err) {
      setTicketDialogError(err.message === 'Nothing to update.' ? 'No changes to save.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveTicketMember = (m) => {
    openActionModal({
      title: `Remove ${m.name}`,
      message: 'Removes this member from the group roster. Any unpaid payment records for past rounds are removed with them. This is refused if they already won a round or have payments marked as paid.',
      confirmLabel: 'Remove Member',
      danger: true,
      onConfirm: async () => {
        await api.delete(`/tickets/${selectedTicket.id}/members/${m.id}`);
        showToast(`${m.name} removed from the group.`);
        fetchTicketDetails(selectedTicket.id);
      },
    });
  };

  const isLatestRound = (a) => ticketAuctions.every(x => x.round_number <= a.round_number);

  const openEditRound = (a) => {
    setTicketDialogError('');
    setEditRoundForm({ id: a.id, round_number: a.round_number, auction_date: toDateInputValue(a.auction_date), winner_member_id: a.winner_member_id || '' });
  };

  const handleSaveRoundEdit = async (e) => {
    e.preventDefault();
    const f = editRoundForm;
    if (!f || !selectedTicket) return;
    setTicketDialogError('');
    setLoading(true);
    try {
      await api.patch(`/tickets/${selectedTicket.id}/auctions/${f.id}`, { winner_member_id: f.winner_member_id || null, auction_date: f.auction_date });
      showToast(`Round ${f.round_number} updated.`);
      setEditRoundForm(null);
      fetchTicketDetails(selectedTicket.id);
    } catch (err) {
      setTicketDialogError(err.message === 'Nothing to update.' ? 'No changes to save.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUndoRound = (a) => {
    openActionModal({
      title: `Undo round ${a.round_number}`,
      message: 'Removes this round and its payment tracking so you can run it again with the right figures (for example a wrong bid). Refused if any payment for this round is already marked paid.',
      confirmLabel: 'Undo Round',
      danger: true,
      onConfirm: async () => {
        const res = await api.delete(`/tickets/${selectedTicket.id}/auctions/${a.id}`);
        showToast(res.message);
        fetchTicketDetails(selectedTicket.id);
      },
    });
  };

  const handleAssignAuctionWinner = async (auctionId) => {
    if (!assignWinnerMemberId) {
      showToast('Choose a member first.', 'error');
      return;
    }
    try {
      await api.patch(`/tickets/${selectedTicket.id}/auctions/${auctionId}`, { winner_member_id: assignWinnerMemberId });
      showToast('Winner assigned.');
      setAssigningWinnerFor(null);
      setAssignWinnerMemberId('');
      fetchTicketDetails(selectedTicket.id);
    } catch (err) {
      showToast(err.message || 'Could not assign winner.', 'error');
    }
  };

  const handleAddTicketMember = async (e) => {
    e.preventDefault();
    if (!selectedTicketIdState) return;
    setLoading(true);
    setError('');
    try {
      const member = await api.post(`/tickets/${selectedTicketIdState}/members`, {
        name: newMemberForm.name,
        phone: newMemberForm.phone
      });
      showToast(`Member '${newMemberForm.name}' added successfully.`);
      setNewMemberForm({ name: '', phone: '' });
      // Refresh details
      fetchTicketDetails(selectedTicketIdState);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Parses pasted lines like "Name, Phone" (or just "Name" — phone is
  // optional) and adds them one at a time through the same validated
  // single-add endpoint above, rather than a separate bulk API — reuses
  // its member-limit check as-is instead of duplicating that logic, and
  // means a mid-list failure (limit reached) still leaves everything
  // before it correctly saved instead of an all-or-nothing transaction.
  const handleBulkAddMembers = async () => {
    if (!selectedTicketIdState) return;
    const lines = bulkMemberText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      showToast('Paste at least one member first.', 'error');
      return;
    }

    setBulkAddingMembers(true);
    setError('');
    let added = 0;
    const failures = [];
    for (const line of lines) {
      const [namePart, ...rest] = line.split(/,|\t/);
      const name = (namePart || '').trim();
      const phone = rest.join(',').trim();
      if (!name) continue;
      try {
        await api.post(`/tickets/${selectedTicketIdState}/members`, { name, phone: phone || undefined });
        added += 1;
      } catch (err) {
        failures.push(`${name}: ${err.message}`);
        // Stop early once the group's member limit is hit — every
        // subsequent line would fail the same way.
        if (err.message?.includes('member limit')) break;
      }
    }

    setBulkAddingMembers(false);
    fetchTicketDetails(selectedTicketIdState);

    if (added > 0) showToast(`Added ${added} member${added === 1 ? '' : 's'}.`);
    if (failures.length > 0) {
      showToast(`${failures.length} skipped: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`, 'error');
    }
    if (added > 0) setBulkMemberText('');
  };

  const handleRunTicketAuction = async (e) => {
    e.preventDefault();
    if (!selectedTicketIdState) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.post(`/tickets/${selectedTicketIdState}/auctions`, {
        bid_amount: parseFloat(auctionForm.bid_amount),
        winner_member_id: auctionForm.winner_member_id || undefined,
        auction_date: auctionForm.auction_date,
        next_round_date: auctionForm.next_round_date || undefined
      });
      showToast(`Successfully recorded auction for round ${result.round_number}.`);
      // Refresh details
      fetchTicketDetails(selectedTicketIdState);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTicketPayment = async (paymentId, isPaid) => {
    if (!selectedTicketIdState) return;
    try {
      const res = await api.put(`/tickets/${selectedTicketIdState}/payments`, {
        payment_id: paymentId,
        is_paid: isPaid
      });
      showToast(`Payment status updated.`);
      // Refresh payments list without full detail reload
      handleFetchTicketPaymentsByRound(ticketPaymentFilterRound);
    } catch (err) {
      setError(err.message);
    }
  };

  const isValidNIC = (nic) => {
    if (!nic) return false;
    const cleaned = nic.trim().toUpperCase();
    return /^[0-9]{9}[VX]$/.test(cleaned) || /^[0-9]{12}$/.test(cleaned);
  };

  // Live NIC lookup — fired on blur (not every keystroke) once a field
  // looks like a complete NIC. Keyed so the borrower field and each
  // guarantor form's field can hold independent results ('borrower',
  // 'guarantor_0', 'guarantor_1', ...). Surfaces two things ahead of
  // submit instead of only after: how many active/pending loans this NIC
  // already guarantees (max 3), and whether it has a defaulted loan on
  // file as either borrower or guarantor ("bad record").
  const [nicLookup, setNicLookup] = useState({});
  const runNicLookup = async (key, nicValue) => {
    const clean = (nicValue || '').trim().toUpperCase();
    if (!isValidNIC(clean)) {
      setNicLookup(prev => ({ ...prev, [key]: null }));
      return;
    }
    setNicLookup(prev => ({ ...prev, [key]: { loading: true } }));
    try {
      const data = await api.get(`/nic-lookup?nic=${encodeURIComponent(clean)}`);
      setNicLookup(prev => ({ ...prev, [key]: { loading: false, data } }));
    } catch (err) {
      setNicLookup(prev => ({ ...prev, [key]: { loading: false, error: err.message } }));
    }
  };

  // Shared warning banner renderer for a NIC lookup result — used for the
  // borrower NIC field and every guarantor's NIC field.
  const renderNicLookupWarning = (key, { forGuarantee } = {}) => {
    const lookup = nicLookup[key];
    if (!lookup || lookup.loading || lookup.error || !lookup.data) return null;
    const { hasDefaultedHistory, defaultedAsBorrower, defaultedAsGuarantor, activeGuaranteedLoansCount } = lookup.data;
    const warnings = [];
    if (hasDefaultedHistory) {
      const parts = [];
      if (defaultedAsBorrower?.length) parts.push(`${defaultedAsBorrower.length} defaulted loan(s) as borrower`);
      if (defaultedAsGuarantor?.length) parts.push(`${defaultedAsGuarantor.length} defaulted loan(s) as guarantor`);
      warnings.push({ level: 'rose', text: `⚠ Bad Record: This NIC has ${parts.join(' and ')} on file.` });
    }
    if (forGuarantee && activeGuaranteedLoansCount >= MAX_ACTIVE_GUARANTEED_LOANS) {
      warnings.push({ level: 'rose', text: `This NIC is already guaranteeing ${activeGuaranteedLoansCount} active/pending loans — the maximum of ${MAX_ACTIVE_GUARANTEED_LOANS} at a time.` });
    } else if (forGuarantee && activeGuaranteedLoansCount > 0) {
      warnings.push({ level: 'amber', text: `This NIC is already guaranteeing ${activeGuaranteedLoansCount} active/pending loan(s) (max ${MAX_ACTIVE_GUARANTEED_LOANS}).` });
    }
    if (warnings.length === 0) return null;
    return (
      <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {warnings.map((w, idx) => (
          <span key={idx} style={{
            fontSize: '12px', fontWeight: '600', padding: '6px 10px', borderRadius: '6px', display: 'block',
            background: w.level === 'rose' ? 'rgba(244,63,94,0.12)' : 'rgba(245,158,11,0.12)',
            color: w.level === 'rose' ? 'var(--accent-rose)' : 'var(--accent-amber)'
          }}>
            {w.text}
          </span>
        ))}
      </div>
    );
  };

  const handleShareWhatsAppReceipt = (receipt) => {
    if (!receipt) return;
    const cleanPhone = (receipt.borrower_phone || '').replace(/[^0-9]/g, '');
    const intlPhone = cleanPhone.startsWith('0') ? '94' + cleanPhone.slice(1) : (cleanPhone.startsWith('94') ? cleanPhone : '94' + cleanPhone);
    const text = `*${(orgSettings.org_name || 'YOUR ORGANIZATION').toUpperCase()} — OFFICIAL PAYMENT RECEIPT*\n\n` +
      `🧾 *Receipt ID:* ${receipt.id}\n` +
      `📅 *Date:* ${new Date(receipt.payment_date).toLocaleString()}\n` +
      `👤 *Borrower:* ${receipt.borrower_name}\n` +
      `💰 *Amount Collected:* LKR ${parseFloat(receipt.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
      `📝 *Payment Type:* ${receipt.payment_type === 'principal' ? 'Principal Repayment' : receipt.payment_type === 'flat_installment' ? 'Installment Payment' : 'Interest Payment'}\n` +
      (receipt.loan_interest_type === 'daily'
        ? ((receipt.loan_principal_outstanding !== null && receipt.loan_principal_outstanding !== undefined) ? `💳 *Total Outstanding:* LKR ${(parseFloat(receipt.loan_principal_outstanding || 0) + parseFloat(receipt.loan_interest_balance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` : '')
        : (receipt.loan_principal_outstanding ? `💳 *Remaining Principal:* LKR ${parseFloat(receipt.loan_principal_outstanding).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` : '') +
          (receipt.loan_interest_balance ? `💸 *Interest Due:* LKR ${parseFloat(receipt.loan_interest_balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` : '')
      ) +
      `🤝 *Recorded By:* ${receipt.agent_name || 'Branch Office'}\n\n` +
      `_Thank you for your timely payment!_`;
    const url = `https://wa.me/${intlPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  // Only Name, Phone, NIC actually block moving on — matching the bar
  // Skyloan uses. Address, date of birth, and the KYC photos are still
  // collected here (unlike Skyloan, which dropped the fields from the form
  // entirely) — they're just no longer required to disburse.
  const runKYCValidation = () => {
    const errors = {};
    let firstErrorField = null;

    if (!newLoan.borrower_name || !newLoan.borrower_name.trim()) {
      errors.borrower_name = "Borrower name is required.";
      if (!firstErrorField) firstErrorField = "borrower_name";
    }
    if (!newLoan.borrower_phone || !newLoan.borrower_phone.trim()) {
      errors.borrower_phone = "Borrower phone number is required.";
      if (!firstErrorField) firstErrorField = "borrower_phone";
    }
    if (!newLoan.nic_number || !isValidNIC(newLoan.nic_number)) {
      errors.nic_number = "A valid Sri Lankan NIC number is required (9 digits + V/X, or 12 digits).";
      if (!firstErrorField) firstErrorField = "nic_number";
    }

    setValidationErrors(prev => ({ ...prev, ...errors }));

    if (firstErrorField) {
      setTimeout(() => {
        const element = document.getElementById(firstErrorField);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.focus();
        }
      }, 50);
      return false;
    }
    return true;
  };

  // Loan purpose / monthly income are still collected here, just optional
  // now — nothing on this step blocks moving on.
  const runFinancialValidation = () => true;

  const runTermsValidation = () => {
    const errors = {};
    let firstErrorField = null;

    if (!newLoan.principal_amount || parseFloat(newLoan.principal_amount) <= 0) {
      errors.principal_amount = "Principal amount must be a positive number.";
      if (!firstErrorField) firstErrorField = "principal_amount";
    }
    if (!newLoan.interest_rate || parseFloat(newLoan.interest_rate) < 0) {
      errors.interest_rate = "Interest rate must be a non-negative number.";
      if (!firstErrorField) firstErrorField = "interest_rate";
    }
    if (newLoan.collection_mode === 'fixed_term' && (!newLoan.duration_periods || parseInt(newLoan.duration_periods, 10) <= 0)) {
      errors.duration_periods = "Duration period is required for fixed term loans.";
      if (!firstErrorField) firstErrorField = "duration_periods";
    } else if (newLoan.interest_type === 'daily' && newLoan.collection_mode === 'fixed_term' && parseInt(newLoan.duration_periods, 10) % 31 !== 0) {
      errors.duration_periods = "Daily Fixed Term duration must be 31, 62, 93, etc. (a multiple of 31 — one extra collection day per month).";
      if (!firstErrorField) firstErrorField = "duration_periods";
    }

    setValidationErrors(prev => ({ ...prev, ...errors }));

    if (firstErrorField) {
      setTimeout(() => {
        const element = document.getElementById(firstErrorField);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.focus();
        }
      }, 50);
      return false;
    }
    return true;
  };

  // Same minimal bar as the borrower — Name, Phone, NIC. NIC photo and
  // address are still collected here, just no longer required.
  const runGuarantorValidation = () => {
    const errors = {};
    let firstErrorField = null;

    guarantorForms.forEach((g, i) => {
      if (!g.full_name || !g.full_name.trim()) {
        errors[`guarantor_${i}_full_name`] = "Guarantor full name is required.";
        if (!firstErrorField) firstErrorField = `guarantor_${i}_full_name`;
      }
      if (!g.nic_number || !isValidNIC(g.nic_number)) {
        errors[`guarantor_${i}_nic_number`] = "A valid Sri Lankan NIC number is required for the guarantor.";
        if (!firstErrorField) firstErrorField = `guarantor_${i}_nic_number`;
      }
      if (!g.phone || !g.phone.trim()) {
        errors[`guarantor_${i}_phone`] = "Guarantor phone number is required.";
        if (!firstErrorField) firstErrorField = `guarantor_${i}_phone`;
      }
    });

    setValidationErrors(prev => ({ ...prev, ...errors }));

    if (firstErrorField) {
      setTimeout(() => {
        const element = document.getElementById(firstErrorField);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.focus();
        }
      }, 50);
      return false;
    }
    return true;
  };

  const handleWizardNext = (currentStep) => {
    setError('');
    if (currentStep === 1) {
      if (runKYCValidation()) setGiveLoanStep(2);
    } else if (currentStep === 2) {
      if (runFinancialValidation()) setGiveLoanStep(3);
    } else if (currentStep === 3) {
      if (runTermsValidation()) {
        if (includeGuarantor) {
          setGiveLoanStep(4);
        } else {
          handleCreateLoan();
        }
      }
    } else if (currentStep === 4) {
      if (runGuarantorValidation()) {
        handleCreateLoan();
      }
    }
  };

  const handleWizardBack = (currentStep) => {
    setError('');
    setGiveLoanStep(Math.max(1, currentStep - 1));
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    handleWizardNext(giveLoanStep);
  };

  // Admin: Create new loan
  const handleCreateLoan = async (e) => {
    if (e) e.preventDefault();
    setError('');
    
    if (!runKYCValidation()) {
      setGiveLoanStep(1);
      return;
    }
    if (!runFinancialValidation()) {
      setGiveLoanStep(2);
      return;
    }
    if (!runTermsValidation()) {
      setGiveLoanStep(3);
      return;
    }
    if (includeGuarantor && !runGuarantorValidation()) {
      setGiveLoanStep(4);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const payload = {
        ...newLoan,
        borrower_date_of_birth: newLoan.date_of_birth,
        guarantors: includeGuarantor ? guarantorForms : [],
        borrower_profile: borrowerProfileForm
      };
      await api.post('/loans', payload);
      showToast(
        user.role === 'agent'
          ? `Loan application for ${newLoan.borrower_name} submitted — awaiting admin approval.`
          : `Loan disbursed to ${newLoan.borrower_name} successfully! Notification sent.`
      );
      setNewLoan({
        borrower_name: '',
        borrower_phone: '',
        borrower_address: '',
        borrower_email: '',
        borrower_gender: '',
        date_of_birth: '',
        principal_amount: '',
        interest_rate: '2.00',
        interest_type: 'daily',
        assigned_agent_id: '',
        nic_number: '',
        nic_photos: [],
        photo_proofs: [],
        collection_mode: 'open_ended',
        duration_periods: '',
        disbursement_date: todayLocalDateStr(),
        source_intake_id: null
      });
      setGiveLoanStep(1);
      setIncludeGuarantor(false);
      setGuarantorForms([emptyGuarantor]);
      setBorrowerProfileForm(emptyBorrowerProfile);
      setValidationErrors({});
      fetchDashboardData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Pre-fills the Give Loan wizard from a reviewed Borrower Intake
  // submission (see the Applications view) instead of starting from a
  // blank form — staff still walk through and confirm every step (adding
  // NIC/address photos, setting loan terms) before anything's disbursed,
  // this just saves re-typing what the borrower already provided.
  const handleConvertIntakeToLoan = async (intake) => {
    // The list this is called from (BorrowerIntakesLoader) fetches intakes
    // with photos stripped (stripIntakeMediaList — same reasoning as the
    // loan list), so pull the full record, photos and guarantors included,
    // before pre-filling. Falls back to the stripped list item on failure
    // so the rest of the pre-fill still works even if photos don't load.
    let full = intake;
    try {
      full = await api.get(`/borrower-intakes/${intake.id}`);
    } catch (err) {
      showToast('Could not load full application details — pre-filling what is available.', 'error');
    }

    const intakeGuarantors = Array.isArray(full.guarantors) ? full.guarantors : [];
    const mappedGuarantors = intakeGuarantors.map(g => ({
      full_name: g.full_name || '',
      nic_number: g.nic_number || '',
      address: g.address || '',
      phone: g.phone || '',
      nic_photos: Array.isArray(g.nic_photo_urls) ? g.nic_photo_urls : [],
      protected_under_debt_act: !!g.protected_under_debt_act,
      has_pending_court_cases: !!g.has_pending_court_cases,
      monthly_income_business: g.monthly_income_business ?? '',
      monthly_income_agriculture: g.monthly_income_agriculture ?? '',
      monthly_income_other: g.monthly_income_other ?? '',
      monthly_expense_food: g.monthly_expense_food ?? '',
      monthly_expense_rent: g.monthly_expense_rent ?? '',
      monthly_expense_other: g.monthly_expense_other ?? ''
    }));

    setNewLoan(prev => ({
      ...prev,
      borrower_name: full.borrower_name || '',
      borrower_phone: full.borrower_phone || '',
      borrower_address: full.borrower_address || '',
      date_of_birth: full.date_of_birth ? String(full.date_of_birth).slice(0, 10) : '',
      nic_number: full.nic_number || '',
      nic_photos: Array.isArray(full.nic_photo_urls) ? full.nic_photo_urls : [],
      photo_proofs: Array.isArray(full.photo_proof_urls) ? full.photo_proof_urls : [],
      source_intake_id: full.id
    }));
    setBorrowerProfileForm({
      loan_purpose: full.loan_purpose || '',
      monthly_income: full.monthly_income !== null && full.monthly_income !== undefined ? String(full.monthly_income) : '',
      spouse_name: full.spouse_name || '',
      spouse_nic: full.spouse_nic || '',
      spouse_occupation: full.spouse_occupation || ''
    });
    if (mappedGuarantors.length > 0) {
      setIncludeGuarantor(true);
      setGuarantorForms(mappedGuarantors);
    } else {
      setIncludeGuarantor(false);
      setGuarantorForms([emptyGuarantor]);
    }
    setGiveLoanStep(1);
    setValidationErrors({});
    setView('create-loan');
    showToast(`Pre-filled from ${full.borrower_name}'s application — please review before submitting.`);
  };

  // Admin: Force accrue interest for testing
  const handleForceAccrue = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.post('/loans/accrue-interest');
      const accruedCount = result.results?.filter(r => r.status === 'accrued').length || 0;
      showToast(`Accrual check completed. Accrued interest on ${accruedCount} active loans.`);
      fetchDashboardData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Agent: Submit cash collection
  const handleCollectPayment = async (e) => {
    e.preventDefault();
    if (!paymentForm.loan_id) {
      setError('Please select a borrower/loan.');
      return;
    }
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    setLoading(true);
    setError('');
    // Find which loan was updated
    const loan = agentData.assignedLoans.find(l => l.id === paymentForm.loan_id);
    const kind = paymentForm.payment_type === 'interest' ? 'Interest' : 'Principal';
    const submitKey = paymentForm.idempotency_key || ('idemp_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now());
    try {
      const result = await submitPaymentOrQueue('/payments', {
        loan_id: paymentForm.loan_id,
        payment_type: paymentForm.payment_type,
        amount: parseFloat(paymentForm.amount),
        notes: paymentForm.notes,
        proof_image_url: paymentForm.proof_image || null,
        payment_method: paymentForm.payment_method,
        idempotency_key: submitKey
      }, { borrowerName: loan?.borrower_name, amount: paymentForm.amount, kind });

      const changeDue = result.data?.change_due || 0;

      if (result.queued) {
        showToast(`No connection — ${kind.toLowerCase()} collection of LKR ${parseFloat(paymentForm.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from ${loan?.borrower_name || 'Borrower'} saved and will sync automatically once you're back online.`, 'info');
      } else {
        if (changeDue > 0) {
          showToast(`${kind} payment cleared! Loan payoff capped — change to return to borrower: LKR ${changeDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`, 'info');
        } else {
          showToast(`${kind} collection recorded successfully! LKR ${parseFloat(paymentForm.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} collected from ${loan?.borrower_name || 'Borrower'}.`);
        }
        // Update data
        fetchDashboardData();
      }

      // Reset payment form with a fresh idempotency key immediately so any subsequent
      // offline or online payment for this or other loans gets a unique key with zero collision.
      resetPaymentForm(paymentForm.loan_id);

      // Deliberately NOT auto-opening the receipt here — forcing a full
      // receipt screen after every single collection is unnecessary
      // friction, especially for daily loans collected every day. The
      // receipt for this (or any past) transaction is still available
      // on demand from the loan's passbook/payment history.
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLedgerCollectPayment = async (e) => {
    e.preventDefault();
    if (!loanStatement || !loanStatement.loan) return;
    const loanId = loanStatement.loan.id;
    if (!ledgerPaymentForm.amount || parseFloat(ledgerPaymentForm.amount) <= 0) {
      showToast('Please enter a valid amount.', 'error');
      return;
    }

    setLoading(true);
    setError('');
    const isFlatInstallmentLoan = !!loanStatement.loan.is_flat_installment;
    const kind = isFlatInstallmentLoan ? 'Daily installment' : (ledgerPaymentForm.payment_type === 'interest' ? 'Interest' : 'Principal');
    try {
      const result = await submitPaymentOrQueue('/payments', {
        loan_id: loanId,
        payment_type: isFlatInstallmentLoan ? 'flat_installment' : ledgerPaymentForm.payment_type,
        amount: parseFloat(ledgerPaymentForm.amount),
        notes: ledgerPaymentForm.notes,
        proof_image_url: ledgerPaymentForm.proof_image || null,
        payment_method: ledgerPaymentForm.payment_method,
        idempotency_key: ledgerPaymentForm.idempotency_key || (Math.random().toString(36).substring(2) + Date.now())
      }, { borrowerName: loanStatement.loan.borrower_name, amount: ledgerPaymentForm.amount, kind });

      setLedgerPaymentForm({
        payment_type: 'interest',
        amount: '',
        notes: '',
        proof_image: '',
        payment_method: 'cash',
        idempotency_key: Math.random().toString(36).substring(2) + Date.now()
      });

      if (result.queued) {
        // No network right now — the entry is saved locally and will
        // replay automatically once back online (see syncQueuedPayments).
        // Deliberately NOT refetching loan details here: the server hasn't
        // actually applied this payment yet, so refetching would just
        // show the same pre-payment balance and look like nothing happened.
        showToast(`No connection — ${kind.toLowerCase()} payment of LKR ${parseFloat(ledgerPaymentForm.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} saved and will sync automatically once you're back online.`, 'info');
      } else {
        showToast(`${kind} collection recorded successfully! LKR ${parseFloat(ledgerPaymentForm.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} collected.`);
        const updatedDetails = await api.get(`/loans/${loanId}`);
        setLoanStatement(updatedDetails);
        fetchDashboardData();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // View loan statement
  const viewStatement = async (loanId) => {
    setSelectedLoanId(loanId);
    setView('ledger');
    setLedgerTab('passbook');
    // Reset to the Record Payment sub-tab every time (mobile only — see
    // passbookMobileTab), not just on first mount. Without this, opening
    // one loan, switching to its Activity Log, then tapping a DIFFERENT
    // loan from the directory would land you on that other loan's Activity
    // Log too — carrying over a tab choice that had nothing to do with the
    // new loan, and defeating a "tap card -> pay" quick action.
    setPassbookMobileTab('record');
    setLedgerPaymentForm({
      payment_type: 'interest',
      amount: '',
      notes: '',
      proof_image: '',
      payment_method: 'cash',
      idempotency_key: Math.random().toString(36).substring(2) + Date.now()
    });
    setShowGuarantorEditor(false);
    setLoading(true);
    try {
      const details = await api.get(`/loans/${loanId}`);
      setLoanStatement(details);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Admin: add or edit the guarantor on an already-created loan.
  const handleOpenGuarantorEditor = (existingGuarantor) => {
    setGuarantorEditForm(existingGuarantor ? {
      full_name: existingGuarantor.full_name || '',
      nic_number: existingGuarantor.nic_number || '',
      address: existingGuarantor.address || '',
      phone: existingGuarantor.phone || '',
      protected_under_debt_act: !!existingGuarantor.protected_under_debt_act,
      monthly_income_business: existingGuarantor.monthly_income_business || '',
      monthly_income_agriculture: existingGuarantor.monthly_income_agriculture || '',
      monthly_income_other: existingGuarantor.monthly_income_other || '',
      monthly_expense_food: existingGuarantor.monthly_expense_food || '',
      monthly_expense_rent: existingGuarantor.monthly_expense_rent || '',
      monthly_expense_other: existingGuarantor.monthly_expense_other || ''
    } : emptyGuarantor);
    setShowGuarantorEditor(true);
  };

  const handleSaveGuarantor = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.put(`/loans/${loanStatement.loan.id}/guarantor`, guarantorEditForm);
      showToast('Guarantor saved.');
      setShowGuarantorEditor(false);
      viewStatement(loanStatement.loan.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveGuarantor = () => {
    openActionModal({
      title: 'Remove Guarantor',
      message: 'Remove the guarantor from this loan?',
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async () => {
        await api.delete(`/loans/${loanStatement.loan.id}/guarantor`);
        showToast('Guarantor removed.');
        viewStatement(loanStatement.loan.id);
      },
    });
  };

  // File to base64 converter for proof of payment
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPaymentForm(prev => ({ ...prev, proof_image: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  // Max photos allowed per field (NIC Photo / Photo Proof), borrower and
  // guarantor alike — mirrors MAX_PHOTOS_PER_FIELD in src/lib/services/image.js.
  const MAX_KYC_PHOTOS = 4;

  // Downscales + JPEG-compresses a single image file via canvas before it
  // becomes a base64 data URL. Previously these fields stored the raw file
  // untouched (already capped at 4MB server-side) — now that up to 4 photos
  // can be attached per field, compressing keeps typical uploads well under
  // that limit and keeps the loan record from ballooning in size.
  const compressImageFile = (file, maxDim = 1600, quality = 0.82) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height / width) * maxDim);
            width = maxDim;
          } else {
            width = Math.round((width / height) * maxDim);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // Shared multi-file appender for NIC Photo / Photo Proof fields — reads +
  // compresses every selected file, appends to whatever's already in that
  // field, and caps the combined total at MAX_KYC_PHOTOS. `updateArrayFn` is
  // called with (prevArray => nextArray) so each call site can plug it into
  // its own setState shape (top-level newLoan vs. one guarantorForms entry).
  const appendKYCPhotos = async (fileList, updateArrayFn) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    try {
      const compressed = await Promise.all(files.map(f => compressImageFile(f)));
      let overflowed = false;
      updateArrayFn(prevArray => {
        const combined = [...(prevArray || []), ...compressed];
        if (combined.length > MAX_KYC_PHOTOS) overflowed = true;
        return combined.slice(0, MAX_KYC_PHOTOS);
      });
      if (overflowed && showToast) {
        showToast(`Only the first ${MAX_KYC_PHOTOS} photos are kept for this field (max ${MAX_KYC_PHOTOS}).`, 'error');
      }
    } catch (err) {
      if (showToast) showToast(err.message || 'Failed to process one of the selected images.', 'error');
    }
  };

  // File to base64 converter(s) for borrower NIC photo (up to 4)
  const handleNICPhotoChange = (e) => {
    appendKYCPhotos(e.target.files, (fn) => setNewLoan(prev => ({ ...prev, nic_photos: fn(prev.nic_photos) })));
    e.target.value = '';
  };
  const removeNICPhoto = (idx) => {
    setNewLoan(prev => ({ ...prev, nic_photos: (prev.nic_photos || []).filter((_, i) => i !== idx) }));
  };

  // File to base64 converter(s) for borrower photo proof (up to 4)
  const handleAddressProofChange = (e) => {
    appendKYCPhotos(e.target.files, (fn) => setNewLoan(prev => ({ ...prev, photo_proofs: fn(prev.photo_proofs) })));
    e.target.value = '';
  };
  const removePhotoProof = (idx) => {
    setNewLoan(prev => ({ ...prev, photo_proofs: (prev.photo_proofs || []).filter((_, i) => i !== idx) }));
  };

  // Updates one field on one guarantor form in the guarantorForms array.
  const updateGuarantorField = (index, field, value) => {
    setGuarantorForms(prev => prev.map((g, i) => (i === index ? { ...g, [field]: value } : g)));
  };

  // Manual add/remove for guarantor forms, up to MAX_GUARANTORS_PER_LOAN —
  // replaces the old "one guarantor per dependent" auto-sizing now that
  // Number of Dependents has been dropped from the borrower profile.
  const handleAddGuarantorForm = () => {
    setGuarantorForms(prev => (prev.length >= MAX_GUARANTORS_PER_LOAN ? prev : [...prev, { ...emptyGuarantor }]));
  };
  const handleRemoveGuarantorForm = (index) => {
    setGuarantorForms(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  // File to base64 converter(s) for a guarantor's NIC photo (up to 4, per
  // guarantor form — indexed since there can be more than one guarantor).
  const handleGuarantorPhotoChange = (index, e) => {
    appendKYCPhotos(e.target.files, (fn) => setGuarantorForms(prev => prev.map((g, i) => (i === index ? { ...g, nic_photos: fn(g.nic_photos) } : g))));
    e.target.value = '';
  };
  const removeGuarantorNICPhoto = (index, idx) => {
    setGuarantorForms(prev => prev.map((g, i) => (i === index ? { ...g, nic_photos: (g.nic_photos || []).filter((_, pi) => pi !== idx) } : g)));
  };
  // No handler for a guarantor's photo proof — that field was removed from
  // the guarantor form (see runGuarantorValidation and the guarantor JSX
  // below); NIC Photo alone is collected for guarantors now.

  // File to base64 converter for borrower proof of payment
  const handleBorrowerFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setBorrowerPayment(prev => ({ ...prev, proof_image: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  // Generic in-app confirmation/error toast. This is a local UI
  // acknowledgement only — it does NOT mean an SMS was sent (most calls are
  // plain "saved successfully" confirmations). Pass type: 'error' for
  // failures/validation messages; anything else renders as a success toast.
  const showToast = (message, type = 'success') => {
    const id = Date.now() + '_' + Math.random().toString(36).slice(2);
    setToastAlerts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToastAlerts(prev => prev.filter(t => t.id !== id));
    }, 6000);
  };

  // Construct and show transaction receipt
  const handleOpenReceipt = (tx, context = {}) => {
    setSelectedReceipt({
      id: tx.id || tx.idempotency_key || 'N/A',
      payment_date: tx.payment_date || tx.created_at || new Date().toISOString(),
      payment_type: tx.payment_type || context.paymentType || 'interest',
      borrower_name: tx.borrower_name || context.borrowerName || user?.name || 'Customer',
      borrower_phone: tx.borrower_phone || context.borrowerPhone || user?.phone || 'N/A',
      agent_name: tx.agent_name || context.agentName || user?.name || 'Lender Staff',
      amount: parseFloat(tx.amount),
      notes: tx.notes || '',
      payment_method: tx.payment_method || context.paymentMethod || 'cash',
      idempotency_key: tx.idempotency_key || tx.id || '',
      loan_principal: tx.loan_principal !== undefined ? tx.loan_principal : (context.loanPrincipal || null),
      loan_interest_rate: tx.loan_interest_rate !== undefined ? tx.loan_interest_rate : (context.loanInterestRate || null),
      loan_interest_type: tx.loan_interest_type || context.loanInterestType || null,
      loan_principal_outstanding: tx.loan_principal_outstanding !== undefined ? tx.loan_principal_outstanding : (context.loanPrincipalOutstanding !== undefined ? context.loanPrincipalOutstanding : null),
      loan_interest_balance: tx.loan_interest_balance !== undefined ? tx.loan_interest_balance : (context.loanInterestBalance !== undefined ? context.loanInterestBalance : null)
    });
  };

  // Escape closes whichever modal/popup is currently open — see
  // useEscapeToClose's own comment for why. Each one mirrors exactly what
  // that modal's own backdrop-click/Cancel handler already does.
  useEscapeToClose(!!selectedReceipt, () => setSelectedReceipt(null));
  useEscapeToClose(showLoanAgreement, () => setShowLoanAgreement(false));
  useEscapeToClose(showChangePassword, () => setShowChangePassword(false));
  useEscapeToClose(showDeleteLoanModal, () => { setShowDeleteLoanModal(false); setDeleteLoanForm({ reason: '', password: '' }); });
  useEscapeToClose(showSettings, () => setShowSettings(false));
  useEscapeToClose(showCreateTicket, () => setShowCreateTicket(false));
  useEscapeToClose(!!editingUser, () => setEditingUser(null));
  useEscapeToClose(showMoreMenu, () => setShowMoreMenu(false));
  useEscapeToClose(!!actionModal, closeActionModal);
  useEscapeToClose(!!editTicketForm, () => setEditTicketForm(null));
  useEscapeToClose(!!editMemberForm, () => setEditMemberForm(null));
  useEscapeToClose(!!editRoundForm, () => setEditRoundForm(null));

  // Keyboard focus is trapped inside whichever modal is open and restored
  // to the triggering element on close — see useFocusTrap's own comment.
  // One ref per modal, attached to that modal's outermost dialog element.
  const receiptModalRef = useRef(null);
  const loanAgreementModalRef = useRef(null);
  const changePasswordModalRef = useRef(null);
  const deleteLoanModalRef = useRef(null);
  const settingsModalRef = useRef(null);
  const createTicketModalRef = useRef(null);
  const editingUserModalRef = useRef(null);
  const moreMenuModalRef = useRef(null);
  const actionModalRef = useRef(null);
  const editTicketModalRef = useRef(null);
  const editMemberModalRef = useRef(null);
  const editRoundModalRef = useRef(null);
  useFocusTrap(!!selectedReceipt, receiptModalRef);
  useFocusTrap(showLoanAgreement, loanAgreementModalRef);
  useFocusTrap(showChangePassword, changePasswordModalRef);
  useFocusTrap(showDeleteLoanModal, deleteLoanModalRef);
  useFocusTrap(showSettings, settingsModalRef);
  useFocusTrap(showCreateTicket, createTicketModalRef);
  useFocusTrap(!!editingUser, editingUserModalRef);
  useFocusTrap(showMoreMenu, moreMenuModalRef);
  useFocusTrap(!!actionModal, actionModalRef);
  useFocusTrap(!!editTicketForm, editTicketModalRef);
  useFocusTrap(!!editMemberForm, editMemberModalRef);
  useFocusTrap(!!editRoundForm, editRoundModalRef);

  return (
    <div>
      {/* Digital Receipt Modal (Screen View) */}
      {selectedReceipt && (
        <div className="receipt-modal-overlay" onClick={() => setSelectedReceipt(null)}>
          <div ref={receiptModalRef} tabIndex={-1} className="receipt-modal-card" onClick={e => e.stopPropagation()}>
            <div className="receipt-header">
              <div className="receipt-header-icon"><Banknote /></div>
              <div className="receipt-title">{orgSettings.org_name || 'Loan Receipt'}</div>
              <div className="receipt-subtitle">Official Payment Receipt</div>
            </div>

            <div className="receipt-row">
              <span className="receipt-row-label">Receipt ID</span>
              <span className="receipt-row-value receipt-row-value-code">{selectedReceipt.id}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-row-label">Date & Time</span>
              <span className="receipt-row-value">{new Date(selectedReceipt.payment_date).toLocaleString()}</span>
            </div>
            
            <div style={{ borderTop: '1px dashed #cbd5e1', margin: '16px 0' }} />

            <div className="receipt-row">
              <span className="receipt-row-label">Customer</span>
              <span className="receipt-row-value">{selectedReceipt.borrower_name}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-row-label">Mobile</span>
              <span className="receipt-row-value">{selectedReceipt.borrower_phone}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-row-label">Collected By</span>
              <span className="receipt-row-value">{selectedReceipt.agent_name}</span>
            </div>

            <div className="receipt-amount-box">
              <div className="receipt-amount-label">{selectedReceipt.payment_type === 'principal' ? 'Principal Payment' : selectedReceipt.payment_type === 'flat_installment' ? 'Installment Payment' : 'Interest Payment'} Collected</div>
              <div className="receipt-amount-val">LKR {selectedReceipt.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </div>

            {selectedReceipt.loan_principal && (
              <>
                <div style={{ borderTop: '1px dashed #cbd5e1', margin: '16px 0' }} />
                <div className="receipt-row">
                  <span className="receipt-row-label">Original Loan Principal</span>
                  <span className="receipt-row-value">LKR {parseFloat(selectedReceipt.loan_principal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="receipt-row">
                  <span className="receipt-row-label">Interest Rate</span>
                  <span className="receipt-row-value" style={{ textTransform: 'capitalize' }}>{selectedReceipt.loan_interest_rate}% ({selectedReceipt.loan_interest_type})</span>
                </div>
                {selectedReceipt.loan_interest_type === 'daily' ? (
                  <div className="receipt-row">
                    <span className="receipt-row-label">Total Outstanding</span>
                    <span className="receipt-row-value" style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}>
                      LKR {(parseFloat(selectedReceipt.loan_principal_outstanding || 0) + parseFloat(selectedReceipt.loan_interest_balance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="receipt-row">
                      <span className="receipt-row-label">Principal Outstanding</span>
                      <span className="receipt-row-value" style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}>
                        LKR {parseFloat(selectedReceipt.loan_principal_outstanding).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="receipt-row">
                      <span className="receipt-row-label">Interest Due</span>
                      <span className="receipt-row-value" style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}>
                        LKR {parseFloat(selectedReceipt.loan_interest_balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </>
                )}
                <div style={{ borderTop: '1px dashed #cbd5e1', margin: '16px 0' }} />
              </>
            )}

            <div className="receipt-row">
              <span className="receipt-row-label">Payment Method</span>
              <span className="receipt-row-value" style={{ textTransform: 'capitalize' }}>
                {selectedReceipt.payment_method ? selectedReceipt.payment_method.replace('_', ' ') : 'Cash'}
              </span>
            </div>

            {selectedReceipt.idempotency_key && (
              <div className="receipt-row" style={{ marginTop: '6px' }}>
                <span className="receipt-row-label">Security Code</span>
                <span className="receipt-row-value receipt-row-value-code" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {selectedReceipt.idempotency_key}
                </span>
              </div>
            )}

            {selectedReceipt.notes && (
              <div className="receipt-notes-section">
                <strong>Notes:</strong> "{selectedReceipt.notes}"
              </div>
            )}

            <div className="receipt-footer">
              <p>Thank you for your payment!</p>
              <p style={{ fontSize: '11px', marginTop: '4px', color: 'var(--text-muted)' }}>This is a system generated digital receipt.</p>
            </div>

            <div className="receipt-actions">
              <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setSelectedReceipt(null)}>
                Close
              </button>
              <button
                type="button"
                className="glass-btn btn-whatsapp"
                onClick={() => handleShareWhatsAppReceipt(selectedReceipt)}
              >
                <MessageSquare className="icon" /> WhatsApp
              </button>
              <button type="button" className="glass-btn glass-btn-emerald" onClick={() => window.print()}>
                <Printer className="icon" /> Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Print Container (Print View) */}
      {selectedReceipt && (
        <div className="receipt-print-only">
          <div className="print-header">
            {orgSettings.logo_url && <img src={orgSettings.logo_url} alt={`${orgSettings.org_name || 'Organization'} Logo`} style={{ height: '44px', width: 'auto', marginBottom: '6px' }} />}
            <div className="print-title">{orgSettings.org_name || 'Loan Receipt'}</div>
            <div style={{ fontSize: '9pt', color: '#555555', fontWeight: 'bold' }}>Official Payment Receipt</div>
          </div>

          <div className="print-row">
            <span>Receipt ID:</span>
            <span style={{ fontFamily: 'monospace' }}>{selectedReceipt.id}</span>
          </div>
          <div className="print-row">
            <span>Date/Time:</span>
            <span>{new Date(selectedReceipt.payment_date).toLocaleString()}</span>
          </div>

          <div className="print-divider"></div>

          <div className="print-row">
            <span>Customer:</span>
            <span>{selectedReceipt.borrower_name}</span>
          </div>
          <div className="print-row">
            <span>Mobile:</span>
            <span>{selectedReceipt.borrower_phone}</span>
          </div>
          <div className="print-row">
            <span>Agent:</span>
            <span>{selectedReceipt.agent_name}</span>
          </div>

          <div className="print-amount-box">
            <div style={{ fontSize: '8pt', textTransform: 'uppercase', marginBottom: '2px' }}>Amount Collected</div>
            <div className="print-amount-val">LKR {selectedReceipt.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </div>

          {selectedReceipt.loan_principal && (
            <>
              <div className="print-divider"></div>
              <div className="print-row">
                <span>Orig. Principal:</span>
                <span>LKR {parseFloat(selectedReceipt.loan_principal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="print-row">
                <span>Interest Accrual:</span>
                <span style={{ textTransform: 'capitalize' }}>{selectedReceipt.loan_interest_rate}% ({selectedReceipt.loan_interest_type})</span>
              </div>
              {selectedReceipt.loan_interest_type === 'daily' ? (
                <div className="print-row" style={{ fontWeight: 'bold' }}>
                  <span>Total Outstanding:</span>
                  <span>LKR {(parseFloat(selectedReceipt.loan_principal_outstanding || 0) + parseFloat(selectedReceipt.loan_interest_balance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              ) : (
                <>
                  <div className="print-row" style={{ fontWeight: 'bold' }}>
                    <span>Principal Outstanding:</span>
                    <span>LKR {parseFloat(selectedReceipt.loan_principal_outstanding).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="print-row" style={{ fontWeight: 'bold' }}>
                    <span>Interest Due:</span>
                    <span>LKR {parseFloat(selectedReceipt.loan_interest_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </>
              )}
              <div className="print-divider"></div>
            </>
          )}

          <div className="print-row">
            <span>Method:</span>
            <span style={{ textTransform: 'capitalize' }}>
              {selectedReceipt.payment_method ? selectedReceipt.payment_method.replace('_', ' ') : 'Cash'}
            </span>
          </div>

          {selectedReceipt.idempotency_key && (
            <div className="print-row" style={{ marginTop: '5px' }}>
              <span>Security Code:</span>
              <span style={{ fontFamily: 'monospace', fontSize: '8pt' }}>{selectedReceipt.idempotency_key}</span>
            </div>
          )}

          {selectedReceipt.notes && (
            <div style={{ marginTop: '8px', border: '1px dashed #000000', padding: '6px', fontSize: '8pt', fontStyle: 'italic' }}>
              <strong>Notes:</strong> "{selectedReceipt.notes}"
            </div>
          )}

          <div className="print-footer">
            <p>Thank you for your payment!</p>
            <p>This is a system generated digital receipt.</p>
          </div>
        </div>
      )}

      {/* Loan Agreement Modal (Screen View) */}
      {showLoanAgreement && loanStatement && (
        <div className="agreement-modal-overlay receipt-modal-overlay" onClick={() => setShowLoanAgreement(false)}>
          <div ref={loanAgreementModalRef} tabIndex={-1} className="receipt-modal-card" style={{ maxWidth: '640px', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="receipt-header">
              <div className="receipt-header-icon"><FileText /></div>
              <div className="receipt-title">Loan Agreement</div>
              <div className="receipt-subtitle">Reference: {loanStatement.loan.id}</div>
            </div>

            <p style={{ fontSize: '14px', lineHeight: 1.6 }}>
              This agreement is entered into on <strong>{new Date(loanStatement.loan.created_at).toLocaleDateString()}</strong> between the
              Lender and <strong>{loanStatement.loan.borrower_name}</strong> (NIC: {loanStatement.loan.nic_number || 'N/A'}, Address: {loanStatement.loan.borrower_address || 'N/A'}), the Borrower.
            </p>

            <h4 style={{ fontSize: '15px', margin: '16px 0 6px' }}>1. Loan Amount</h4>
            <p style={{ fontSize: '14px' }}>The Lender agrees to give the Borrower a loan of <strong>LKR {parseFloat(loanStatement.loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>.</p>

            <h4 style={{ fontSize: '15px', margin: '16px 0 6px' }}>2. {loanStatement.loan.is_flat_installment ? 'Daily Installment & Repayment' : 'Interest & Repayment'}</h4>
            {loanStatement.loan.is_flat_installment ? (
              <p style={{ fontSize: '14px' }}>
                A flat daily installment of <strong>LKR {parseFloat(loanStatement.loan.daily_installment_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (covering both principal and interest together)
                is payable each day, starting on the date of disbursement, for a total of <strong>{loanStatement.loan.duration_periods || 0} collection days</strong>.
                The total amount repayable over the full term is <strong>LKR {(parseFloat(loanStatement.loan.daily_installment_amount || 0) * (loanStatement.loan.duration_periods || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>.
                The loan is considered fully settled once all {loanStatement.loan.duration_periods || 0} days' installments have been paid in full.
              </p>
            ) : (
              <p style={{ fontSize: '14px' }}>
                Interest is charged at <strong>{loanStatement.loan.interest_rate}%</strong> of the principal, payable every <strong>{loanStatement.loan.interest_type === 'daily' ? 'day' : loanStatement.loan.interest_type === 'weekly' ? 'week' : 'month'}</strong>.
                The principal amount remains payable in full (or in part, at the Borrower's discretion) at any time; the loan is considered
                settled once the full principal of LKR {parseFloat(loanStatement.loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been repaid, regardless of the
                interest payment schedule.
              </p>
            )}

            {loanStatement.loan.loan_purpose && (
              <>
                <h4 style={{ fontSize: '15px', margin: '16px 0 6px' }}>3. Purpose of Loan</h4>
                <p style={{ fontSize: '14px' }}>{loanStatement.loan.loan_purpose}</p>
              </>
            )}

            {(loanStatement.guarantors || []).length > 0 && (
              <>
                <h4 style={{ fontSize: '15px', margin: '16px 0 6px' }}>4. Guarantor{loanStatement.guarantors.length > 1 ? 's' : ''}</h4>
                {loanStatement.guarantors.map((gtor, gi) => (
                  <p style={{ fontSize: '14px' }} key={gtor.id || gi}>
                    <strong>{gtor.full_name}</strong> (NIC: {gtor.nic_number}), residing at {gtor.address},
                    stands as guarantor for this loan and accepts joint responsibility for repayment in the event the Borrower defaults.
                  </p>
                ))}
              </>
            )}

            <h4 style={{ fontSize: '15px', margin: '16px 0 6px' }}>{(loanStatement.guarantors || []).length > 0 ? '5' : loanStatement.loan.loan_purpose ? '4' : '3'}. Default</h4>
            <p style={{ fontSize: '14px' }}>If the Borrower fails to pay interest or repay the principal as agreed, the Lender has the right to take legal action to recover the outstanding amount.</p>

            <h4 style={{ fontSize: '15px', margin: '16px 0 6px' }}>{(loanStatement.guarantors || []).length > 0 ? '6' : loanStatement.loan.loan_purpose ? '5' : '4'}. Declaration</h4>
            <p style={{ fontSize: '14px' }}>Both parties confirm they have read, understood, and agree to all the terms stated above.</p>

            <div className="receipt-actions">
              <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setShowLoanAgreement(false)}>
                Close
              </button>
              <button type="button" className="glass-btn glass-btn-secondary" onClick={() => window.print()}>
                <Printer className="icon" /> Print
              </button>
              <button type="button" className="glass-btn glass-btn-emerald" onClick={handleDownloadAgreement} disabled={downloadingAgreement}>
                <Download className="icon" /> {downloadingAgreement ? 'Generating...' : 'Download PDF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Print Container (Loan Agreement Print View) */}
      {showLoanAgreement && loanStatement && (
        <div className="agreement-print-only">
          <h1>Loan Agreement</h1>
          <p style={{ textAlign: 'center', fontSize: '9pt', color: '#444' }}>Reference: {loanStatement.loan.id}</p>

          <p>
            This agreement is entered into on <strong>{new Date(loanStatement.loan.created_at).toLocaleDateString()}</strong> between the
            Lender and <strong>{loanStatement.loan.borrower_name}</strong> (NIC: {loanStatement.loan.nic_number || 'N/A'}, Address: {loanStatement.loan.borrower_address || 'N/A'}), the Borrower.
          </p>

          <h2>1. Loan Amount</h2>
          <p>The Lender agrees to give the Borrower a loan of <strong>LKR {parseFloat(loanStatement.loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>.</p>

          <h2>2. {loanStatement.loan.is_flat_installment ? 'Daily Installment & Repayment' : 'Interest & Repayment'}</h2>
          {loanStatement.loan.is_flat_installment ? (
            <p>
              A flat daily installment of <strong>LKR {parseFloat(loanStatement.loan.daily_installment_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (covering both principal and interest together)
              is payable each day, starting on the date of disbursement, for a total of <strong>{loanStatement.loan.duration_periods || 0} collection days</strong>.
              The total amount repayable over the full term is <strong>LKR {(parseFloat(loanStatement.loan.daily_installment_amount || 0) * (loanStatement.loan.duration_periods || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>.
              The loan is considered fully settled once all {loanStatement.loan.duration_periods || 0} days' installments have been paid in full.
            </p>
          ) : (
            <p>
              Interest is charged at <strong>{loanStatement.loan.interest_rate}%</strong> of the principal, payable every{' '}
              <strong>{loanStatement.loan.interest_type === 'daily' ? 'day' : loanStatement.loan.interest_type === 'weekly' ? 'week' : 'month'}</strong>.
              The principal amount remains payable in full (or in part, at the Borrower's discretion) at any time; the loan is considered
              settled once the full principal of LKR {parseFloat(loanStatement.loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been repaid, regardless of the
              interest payment schedule.
            </p>
          )}

          {loanStatement.loan.loan_purpose && (
            <>
              <h2>3. Purpose of Loan</h2>
              <p>{loanStatement.loan.loan_purpose}</p>
            </>
          )}

          {(loanStatement.guarantors || []).length > 0 && (
            <>
              <h2>{loanStatement.loan.loan_purpose ? '4' : '3'}. Guarantor{loanStatement.guarantors.length > 1 ? 's' : ''}</h2>
              {loanStatement.guarantors.map((gtor, gi) => (
                <p key={gtor.id || gi}>
                  <strong>{gtor.full_name}</strong> (NIC: {gtor.nic_number}), residing at {gtor.address},
                  stands as guarantor for this loan and accepts joint responsibility for repayment in the event the Borrower defaults.
                </p>
              ))}
            </>
          )}

          <h2>{(loanStatement.guarantors || []).length > 0 ? '5' : loanStatement.loan.loan_purpose ? '4' : '3'}. Default</h2>
          <p>If the Borrower fails to pay interest or repay the principal as agreed, the Lender has the right to take legal action to recover the outstanding amount.</p>

          <h2>{(loanStatement.guarantors || []).length > 0 ? '6' : loanStatement.loan.loan_purpose ? '5' : '4'}. Declaration</h2>
          <p>Both parties confirm they have read, understood, and agree to all the terms stated above.</p>

          <div className="agreement-signature-block">
            <div className="agreement-signature-line">Lender</div>
            <div className="agreement-signature-line">Borrower ({loanStatement.loan.borrower_name})</div>
            {(loanStatement.guarantors || []).map((gtor, gi) => (
              <div className="agreement-signature-line" key={gtor.id || gi}>Guarantor ({gtor.full_name})</div>
            ))}
          </div>
          <div className="agreement-signature-block">
            <div className="agreement-signature-line">Witness 1</div>
            <div className="agreement-signature-line">Witness 2</div>
          </div>
        </div>
      )}

      {/* Toast Alert overlay — a local UI confirmation, not a claim that an
          SMS was actually sent (see showToast above). role="status" on the
          container + aria-live="polite" announces success/info toasts to
          screen readers without interrupting whatever the user is doing;
          each error-type toast additionally gets its own role="alert"
          (implicitly assertive) so a failure is announced immediately
          instead of waiting to be polite — previously these were plain
          divs with no live region at all, so every save/error in the app
          was silent to assistive tech. */}
      <div role="status" aria-live="polite" aria-atomic="false" style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '380px' }}>
        {toastAlerts.map(toast => (
          <div key={toast.id} role={toast.type === 'error' ? 'alert' : undefined} className="animate-fade-in" style={{ padding: '16px', background: toast.type === 'error' ? 'var(--accent-rose, #dc2626)' : toast.type === 'info' ? 'var(--accent-amber, #d97706)' : 'var(--accent-emerald)', border: 'none', color: '#ffffff', borderRadius: '8px', boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {toast.type === 'error' ? <CircleAlert className="icon" /> : toast.type === 'info' ? <Clock className="icon" /> : <CircleCheck className="icon" />}
                {toast.type === 'error' ? 'Error' : toast.type === 'info' ? 'Saved — Pending Sync' : 'Success'}
              </span>
            </div>
            <p style={{ fontSize: '13px', lineHeight: '1.4' }}>{toast.message}</p>
          </div>
        ))}
      </div>

      {/* Header bar - Simple Solid White Bar */}
      {token && user && (
        <header className="app-header animate-fade-in">
          <div className="app-header-info">
            <h1 style={{ fontSize: '22px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              {orgSettings.logo_url ? (
                <img src={orgSettings.logo_url} alt={`${orgSettings.org_name || 'Organization'} Logo`} style={{ height: '42px', width: 'auto', objectFit: 'contain' }} />
              ) : (
                <div style={{ height: '42px', width: '42px', borderRadius: '10px', background: 'var(--accent-blue-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Landmark style={{ width: '22px', height: '22px', color: 'var(--accent-blue)' }} />
                </div>
              )}
              {orgSettings.org_name ? (
                <span style={{ fontWeight: '800', letterSpacing: '0.5px' }}>{orgSettings.org_name.toUpperCase()}</span>
              ) : (
                <span className="skeleton skeleton-line" style={{ height: '20px', width: '140px' }} aria-hidden="true" />
              )}
            </h1>
            <span className="badge badge-active">{user.role}</span>
            {pendingSyncCount > 0 && (
              <button
                type="button"
                className="badge badge-pending"
                style={{ border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={attemptQueueSync}
                title="Payments saved offline, waiting to sync — tap to retry now"
              >
                <Clock style={{ width: '11px', height: '11px' }} /> {pendingSyncCount} pending sync
              </button>
            )}
          </div>

          {/* Desktop Navigation Links */}
          {user.role === 'admin' && view !== 'portal' && view !== 'ticket-dashboard' && view !== 'pawn-dashboard' && (
            <div className="desktop-header-nav">
              <button className={`nav-link-btn ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setSelectedLoanId(null); setLoanStatement(null); }}><Home className="icon" /> Home</button>
              <button className={`nav-link-btn ${view === 'create-loan' ? 'active' : ''}`} onClick={() => { setView('create-loan'); setSelectedLoanId(null); setLoanStatement(null); }}><Banknote className="icon" /> Give Loan</button>
              <button className={`nav-link-btn ${view === 'borrower-intakes' ? 'active' : ''}`} onClick={() => { setView('borrower-intakes'); setSelectedLoanId(null); setLoanStatement(null); }}>
                <ClipboardCheck className="icon" /> Applications
                {pendingIntakeCount > 0 && <span className="badge badge-pending" style={{ marginLeft: '6px', padding: '1px 6px', fontSize: '10px' }}>{pendingIntakeCount}</span>}
              </button>
              <button className={`nav-link-btn ${view === 'record-payment' ? 'active' : ''}`} onClick={() => { setView('record-payment'); setSelectedLoanId(null); setLoanStatement(null); }}><CreditCard className="icon" /> Record Payment</button>
              <button className={`nav-link-btn ${view === 'loans' ? 'active' : ''}`} onClick={() => { setView('loans'); setSelectedLoanId(null); setLoanStatement(null); }}>
                <ClipboardList className="icon" /> Check Loans
                {adminData?.summary?.totalOverdue > 0 && <span className="badge badge-defaulted" style={{ marginLeft: '6px', padding: '1px 6px', fontSize: '10px' }}>{adminData.summary.totalOverdue}</span>}
              </button>
              <button className={`nav-link-btn ${view === 'agents' ? 'active' : ''}`} onClick={() => { setView('agents'); setSelectedLoanId(null); setLoanStatement(null); }}><Users className="icon" /> Agent Route</button>
              <button className={`nav-link-btn ${['admin-tools', 'next-day-tasklist', 'interest-center', 'payment-history', 'audit-log', 'sms-log'].includes(view) ? 'active' : ''}`} onClick={() => setShowMoreMenu(true)}><LayoutGrid className="icon" /> More</button>
              {canSwitchPortals(user) && (
                <button className="nav-link-btn" onClick={() => { setView('portal'); setSelectedLoanId(null); setLoanStatement(null); }} style={{ background: 'rgba(37, 84, 232, 0.1)', color: 'var(--accent-blue)', fontWeight: 'bold' }}>
                  Switch Portal &rarr;
                </button>
              )}
            </div>
          )}
          {user.role === 'agent' && view !== 'portal' && view !== 'ticket-dashboard' && view !== 'pawn-dashboard' && (
            <div className="desktop-header-nav">
              <button className={`nav-link-btn ${view === 'create-loan' ? 'active' : ''}`} onClick={() => { setView('create-loan'); setGiveLoanStep(1); }}><Banknote className="icon" /> Give Loan</button>
              <button className={`nav-link-btn ${view === 'borrower-intakes' ? 'active' : ''}`} onClick={() => { setView('borrower-intakes'); setSelectedLoanId(null); setLoanStatement(null); }}>
                <ClipboardCheck className="icon" /> Applications
                {pendingIntakeCount > 0 && <span className="badge badge-pending" style={{ marginLeft: '6px', padding: '1px 6px', fontSize: '10px' }}>{pendingIntakeCount}</span>}
              </button>
              <button className={`nav-link-btn ${view === 'dashboard' && agentSubView === 'record-payment' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setAgentSubView('record-payment'); }}><Calendar className="icon" /> Route Sheet</button>
              <button className={`nav-link-btn ${view === 'dashboard' && agentSubView === 'collect' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setAgentSubView('collect'); }}><CreditCard className="icon" /> Single Payment</button>
              <button className={`nav-link-btn ${view === 'dashboard' && agentSubView === 'next-day-tasklist' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setAgentSubView('next-day-tasklist'); }}><Calendar className="icon" /> Next Day Tasklist</button>
              <button className={`nav-link-btn ${view === 'dashboard' && agentSubView === 'history' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setAgentSubView('history'); }}><ScrollText className="icon" /> Collection History</button>
              <button className={`nav-link-btn ${view === 'dashboard' && agentSubView === 'remit' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setAgentSubView('remit'); }}><Landmark className="icon" /> Remit Cash</button>
              {canSwitchPortals(user) && (
                <button className="nav-link-btn" onClick={() => { setView('portal'); setSelectedLoanId(null); setLoanStatement(null); }} style={{ background: 'rgba(37, 84, 232, 0.1)', color: 'var(--accent-blue)', fontWeight: 'bold' }}>
                  Switch Portal &rarr;
                </button>
              )}
            </div>
          )}
          {user.role === 'borrower' && (
            <div className="desktop-header-nav">
              <button className={`nav-link-btn ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setSelectedLoanId(null); setLoanStatement(null); }}><Home className="icon" /> Home</button>
            </div>
          )}

          <div className="app-header-nav">
            <span style={{ color: 'var(--text-secondary)', fontSize: '16px' }} className="desktop-only">
              User: <strong style={{ color: 'var(--text-primary)' }}>{user.name}</strong>
            </span>
            {canSwitchPortals(user) && view !== 'portal' && (
              <button className="glass-btn glass-btn-secondary" style={{ padding: '10px 16px', fontSize: '14px', border: '1px solid rgba(59,130,246,0.3)' }} onClick={() => { setView('portal'); setSelectedLoanId(null); setLoanStatement(null); setSelectedTicket(null); setSelectedTicketIdState(null); }}>
                <ArrowLeft className="icon" style={{ color: 'var(--accent-blue)' }} /> <span className="btn-label-text">Switch Portal</span>
              </button>
            )}
            <button className="glass-btn glass-btn-secondary" style={{ padding: '10px 16px', fontSize: '14px' }} onClick={handleOpenSettings}>
              <Settings className="icon" /> <span className="btn-label-text">Settings</span>
            </button>
            <button className="glass-btn glass-btn-rose" style={{ padding: '10px 20px', fontSize: '15px' }} onClick={handleLogout}>
              <LogOut className="icon" /> <span className="btn-label-text">Logout</span>
            </button>
          </div>
        </header>
      )}

      {/* Change Password Modal (all roles) */}
      {showChangePassword && (
        <div className="receipt-modal-overlay" onClick={() => setShowChangePassword(false)}>
          <div ref={changePasswordModalRef} tabIndex={-1} className="glass-card" style={{ maxWidth: '420px', width: '100%' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '20px', marginBottom: '16px' }}><KeyRound className="icon" /> Change Password</h3>
            {user?.mustChangePassword && (
              <p style={{ fontSize: '13px', color: 'var(--accent-rose)', marginBottom: '12px' }}>
                You're using a temporary password. Please set a new one to continue.
              </p>
            )}
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label htmlFor="f-current-password-2739" style={{ fontSize: '13px', fontWeight: 'bold' }}>Current Password</label>
                <input id="f-current-password-2739" type="password" required className="glass-input" style={{ width: '100%' }}
                  value={passwordForm.current_password}
                  onChange={e => setPasswordForm(prev => ({ ...prev, current_password: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="f-new-password-2745" style={{ fontSize: '13px', fontWeight: 'bold' }}>New Password</label>
                <input id="f-new-password-2745" type="password" required minLength={6} className="glass-input" style={{ width: '100%' }}
                  value={passwordForm.new_password}
                  onChange={e => setPasswordForm(prev => ({ ...prev, new_password: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="f-confirm-new-password-2751" style={{ fontSize: '13px', fontWeight: 'bold' }}>Confirm New Password</label>
                <input id="f-confirm-new-password-2751" type="password" required minLength={6} className="glass-input" style={{ width: '100%' }}
                  value={passwordForm.confirm_password}
                  onChange={e => setPasswordForm(prev => ({ ...prev, confirm_password: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                {!user?.mustChangePassword && (
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ flex: 1 }} onClick={() => setShowChangePassword(false)}>Cancel</button>
                )}
                <button type="submit" className="glass-btn glass-btn-emerald" style={{ flex: 1 }} disabled={loading}>Update Password</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Loan confirmation — password re-entry is the actual
          safeguard here, not just another "are you sure" dialog. Closing
          the modal (Cancel, backdrop click) discards whatever was typed —
          deliberately not persisted in state beyond this modal's lifetime. */}
      {showDeleteLoanModal && (
        <div className="receipt-modal-overlay" onClick={() => { setShowDeleteLoanModal(false); setDeleteLoanForm({ reason: '', password: '' }); }}>
          <div ref={deleteLoanModalRef} tabIndex={-1} className="glass-card" style={{ maxWidth: '420px', width: '100%' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '20px', marginBottom: '8px', color: 'var(--accent-rose)' }}><Trash2 className="icon" /> Delete This Loan</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              This permanently removes the loan and cannot be undone. Only use this for a mistaken entry or test data — a real closed-out loan should be Written Off instead, which keeps it in the audit trail.
            </p>
            <form onSubmit={e => { e.preventDefault(); handleDeleteLoan(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label htmlFor="f-reason-2780" style={{ fontSize: '13px', fontWeight: 'bold' }}>Reason</label>
                <input id="f-reason-2780" type="text" required autoFocus className="glass-input" style={{ width: '100%' }}
                  placeholder="e.g. Created by mistake, duplicate entry"
                  value={deleteLoanForm.reason}
                  onChange={e => setDeleteLoanForm(prev => ({ ...prev, reason: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="f-confirm-your-password-2787" style={{ fontSize: '13px', fontWeight: 'bold' }}>Confirm Your Password</label>
                <input id="f-confirm-your-password-2787" type="password" required className="glass-input" style={{ width: '100%' }}
                  value={deleteLoanForm.password}
                  onChange={e => setDeleteLoanForm(prev => ({ ...prev, password: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button type="button" className="glass-btn glass-btn-secondary" style={{ flex: 1 }} onClick={() => { setShowDeleteLoanModal(false); setDeleteLoanForm({ reason: '', password: '' }); }}>Cancel</button>
                <button type="submit" className="glass-btn glass-btn-rose" style={{ flex: 1 }} disabled={loading}>
                  <Trash2 className="icon" /> {loading ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generic action modal — replaces window.prompt/window.confirm
          everywhere in the app (see openActionModal's own comment). Closing
          it (Cancel, backdrop click, Escape) discards whatever was typed. */}
      {actionModal && (
        <div className="receipt-modal-overlay" onClick={closeActionModal}>
          <div ref={actionModalRef} tabIndex={-1} className="glass-card" style={{ maxWidth: '420px', width: '100%' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '20px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: actionModal.danger ? 'var(--accent-rose)' : 'var(--text-primary)' }}>
              {actionModal.danger && <Ban className="icon" />} {actionModal.title}
            </h3>
            {actionModal.message && (
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', whiteSpace: 'pre-line' }}>{actionModal.message}</p>
            )}
            <form onSubmit={e => { e.preventDefault(); handleActionModalConfirm(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(actionModal.fields || []).map((f, i) => (
                <div key={f.key}>
                  <label htmlFor={`am-${f.key}`} style={{ fontSize: '13px', fontWeight: 'bold' }}>{f.label}</label>
                  <input
                    id={`am-${f.key}`}
                    type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                    required={f.required}
                    autoFocus={i === 0}
                    min={f.type === 'number' ? '0.01' : undefined}
                    step={f.type === 'number' ? '0.01' : undefined}
                    placeholder={f.placeholder}
                    className="glass-input"
                    style={{ width: '100%' }}
                    value={actionModalValues[f.key] ?? ''}
                    onChange={e => setActionModalValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              {actionModalError && <p style={{ color: 'var(--accent-rose)', fontSize: '13px', margin: 0 }}>{actionModalError}</p>}
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button type="button" className="glass-btn glass-btn-secondary" style={{ flex: 1 }} onClick={closeActionModal}>Cancel</button>
                <button type="submit" className={`glass-btn ${actionModal.danger ? 'glass-btn-rose' : 'glass-btn-emerald'}`} style={{ flex: 1 }} disabled={actionModalSubmitting}>
                  {actionModalSubmitting ? 'Working...' : (actionModal.confirmLabel || 'Confirm')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal (Profile & Security) */}
      {showSettings && (
        <div className="receipt-modal-overlay" onClick={() => setShowSettings(false)}>
          <div ref={settingsModalRef} tabIndex={-1} className="glass-card" style={{ maxWidth: '480px', width: '100%', padding: '24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <Settings className="icon" style={{ color: 'var(--accent-blue)', width: '24px', height: '24px' }} />
              <h3 style={{ fontSize: '22px', margin: 0 }}>Account Settings</h3>
            </div>

            {settingsError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '14px' }}>
                {settingsError}
              </div>
            )}

            {/* Modal Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-light)', gap: '16px', marginBottom: '20px' }}>
              <button type="button"
                style={{
                  padding: '8px 4px',
                  background: 'none',
                  border: 'none',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: settingsTab === 'profile' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  borderBottom: settingsTab === 'profile' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                  cursor: 'pointer'
                }}
                onClick={() => setSettingsTab('profile')}>
                Edit Profile
              </button>
              <button type="button"
                style={{
                  padding: '8px 4px',
                  background: 'none',
                  border: 'none',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: settingsTab === 'security' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  borderBottom: settingsTab === 'security' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                  cursor: 'pointer'
                }}
                onClick={() => setSettingsTab('security')}>
                Security & Password
              </button>
              {user?.role === 'admin' && (
                <button type="button"
                  style={{
                    padding: '8px 4px',
                    background: 'none',
                    border: 'none',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: settingsTab === 'organization' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    borderBottom: settingsTab === 'organization' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    setOrgSettingsForm({ org_name: orgSettings.org_name || '', logo_url: orgSettings.logo_url || '' });
                    setOrgSettingsError('');
                    setSettingsTab('organization');
                  }}>
                  Organization
                </button>
              )}
            </div>

            {/* Tab 1: Profile Settings */}
            {settingsTab === 'profile' && (
              <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label htmlFor="f-full-name-2874" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Full Name *</label>
                  <input id="f-full-name-2874" type="text" required className="glass-input" style={{ width: '100%' }}
                    value={profileForm.name}
                    onChange={e => setProfileForm(prev => ({ ...prev, name: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="f-phone-number-2880" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Phone Number *</label>
                  <input id="f-phone-number-2880" type="tel" required className="glass-input" style={{ width: '100%' }}
                    value={profileForm.phone}
                    onChange={e => setProfileForm(prev => ({ ...prev, phone: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="f-email-address-2886" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Email Address</label>
                  <input id="f-email-address-2886" type="email" className="glass-input" style={{ width: '100%' }}
                    value={profileForm.email}
                    onChange={e => setProfileForm(prev => ({ ...prev, email: e.target.value }))} />
                </div>


                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ flex: 1 }} onClick={() => setShowSettings(false)}>Cancel</button>
                  <button type="submit" className="glass-btn glass-btn-emerald" style={{ flex: 1 }} disabled={loading}>Save Profile</button>
                </div>
              </form>
            )}

            {/* Tab 2: Security Settings */}
            {settingsTab === 'security' && (
              <form onSubmit={async (e) => {
                e.preventDefault();
                setSettingsError('');
                if (passwordForm.new_password !== passwordForm.confirm_password) {
                  setSettingsError('New password and confirmation do not match.');
                  return;
                }
                setLoading(true);
                try {
                  await api.post('/auth/change-password', {
                    current_password: passwordForm.current_password,
                    new_password: passwordForm.new_password
                  });
                  showToast('Password changed successfully.');
                  setShowSettings(false);
                  setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
                } catch (err) {
                  setSettingsError(err.message);
                } finally {
                  setLoading(false);
                }
              }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label htmlFor="f-current-password-2925" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Current Password</label>
                  <input id="f-current-password-2925" type="password" required className="glass-input" style={{ width: '100%' }}
                    value={passwordForm.current_password}
                    onChange={e => setPasswordForm(prev => ({ ...prev, current_password: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="f-new-password-2931" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>New Password</label>
                  <input id="f-new-password-2931" type="password" required minLength={6} className="glass-input" style={{ width: '100%' }}
                    value={passwordForm.new_password}
                    onChange={e => setPasswordForm(prev => ({ ...prev, new_password: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="f-confirm-new-password-2937" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Confirm New Password</label>
                  <input id="f-confirm-new-password-2937" type="password" required minLength={6} className="glass-input" style={{ width: '100%' }}
                    value={passwordForm.confirm_password}
                    onChange={e => setPasswordForm(prev => ({ ...prev, confirm_password: e.target.value }))} />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ flex: 1 }} onClick={() => setShowSettings(false)}>Cancel</button>
                  <button type="submit" className="glass-btn glass-btn-emerald" style={{ flex: 1 }} disabled={loading}>Update Password</button>
                </div>
              </form>
            )}

            {/* Tab 3: Organization Branding (admin only) — org_name + logo,
                stored in this deployment's own database. This is what lets
                an org's own admin change their name/logo without anyone
                touching code or redeploying — see GET/PATCH /api/settings. */}
            {settingsTab === 'organization' && user?.role === 'admin' && (
              <form onSubmit={async (e) => {
                e.preventDefault();
                setOrgSettingsError('');
                if (!orgSettingsForm.org_name.trim()) {
                  setOrgSettingsError('Organization name cannot be blank.');
                  return;
                }
                setLoading(true);
                try {
                  const res = await api.patch('/settings', {
                    org_name: orgSettingsForm.org_name,
                    logo_url: orgSettingsForm.logo_url || null
                  });
                  setOrgSettings({ org_name: res.org_name || '', logo_url: res.logo_url || null });
                  showToast('Organization branding updated.');
                  setShowSettings(false);
                } catch (err) {
                  setOrgSettingsError(err.message);
                } finally {
                  setLoading(false);
                }
              }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                  This name and logo appear on the header, login screen, receipts, and downloadable loan agreement PDFs.
                </p>
                <div>
                  <label htmlFor="f-organization-name-2981" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Organization Name *</label>
                  <input id="f-organization-name-2981" type="text" required className="glass-input" style={{ width: '100%' }}
                    value={orgSettingsForm.org_name}
                    onChange={e => setOrgSettingsForm(prev => ({ ...prev, org_name: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="f-org-logo" style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Logo</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {orgSettingsForm.logo_url ? (
                      <img src={orgSettingsForm.logo_url} alt="Logo preview" style={{ width: '48px', height: '48px', objectFit: 'contain', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-tertiary)' }} />
                    ) : (
                      <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: 'var(--accent-blue-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Landmark style={{ width: '24px', height: '24px', color: 'var(--accent-blue)' }} />
                      </div>
                    )}
                    <input id="f-org-logo" type="file" accept="image/*" className="glass-input" style={{ flex: 1, padding: '8px' }}
                      onChange={(e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onloadend = () => setOrgSettingsForm(prev => ({ ...prev, logo_url: reader.result }));
                        reader.readAsDataURL(file);
                      }} />
                    {orgSettingsForm.logo_url && (
                      <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 12px', fontSize: '12px' }} onClick={() => setOrgSettingsForm(prev => ({ ...prev, logo_url: '' }))}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {orgSettingsError && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}>
                    {orgSettingsError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ flex: 1 }} onClick={() => setShowSettings(false)}>Cancel</button>
                  <button type="submit" className="glass-btn glass-btn-emerald" style={{ flex: 1 }} disabled={loading}>Save Branding</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Main container */}
      <main className="dashboard-container">
        
        {/* Error panel */}
        {error && (
          <div role="alert" className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)', margin: '0 0 24px 0', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}>Error</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>{error}</p>
            </div>
            <button className="glass-btn glass-btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        {/* ----------------- LOGIN PAGE ----------------- */}
        {!token && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
            <div className="glass-card" style={{ width: '100%', maxWidth: '420px', padding: '32px 28px' }}>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                {orgSettings.logo_url ? (
                  <img src={orgSettings.logo_url} alt={`${orgSettings.org_name || 'Organization'} Logo`} style={{ width: '140px', maxHeight: '140px', height: 'auto', margin: '0 auto 12px auto', display: 'block', borderRadius: '8px', objectFit: 'contain' }} />
                ) : (
                  <div style={{ width: '96px', height: '96px', borderRadius: '16px', background: 'var(--accent-blue-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto' }}>
                    <Landmark style={{ width: '48px', height: '48px', color: 'var(--accent-blue)' }} />
                  </div>
                )}
                {orgSettings.org_name ? (
                  <h2 style={{ fontSize: '26px', margin: '0 0 4px 0', fontWeight: '800', color: 'var(--text-primary)' }}>{orgSettings.org_name.toUpperCase()}</h2>
                ) : (
                  // Org settings haven't loaded yet — a shimmering placeholder
                  // reads as "still loading" the way the rest of the app
                  // already does elsewhere (see .skeleton-line), rather than
                  // showing the literal word "LOADING..." as if it were the
                  // organization's real name.
                  <span className="skeleton skeleton-line" style={{ height: '26px', width: '70%', margin: '0 auto 8px auto' }} aria-hidden="true" />
                )}
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--accent-gold)', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block' }}>Cash Lending & Micro Credit</span>
              </div>

              {!showForgotPassword ? (
                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label htmlFor="f-phone-number-3061" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Phone Number</label>
                    <input id="f-phone-number-3061" type="tel" required className="glass-input" placeholder="e.g. 0771234567" value={loginPhone} onChange={e => setLoginPhone(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="f-password-3065" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Password</label>
                    <input id="f-password-3065" type="password" required className="glass-input" placeholder="••••••••" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} />
                  </div>
                  <button type="submit" className="glass-btn" disabled={loading} style={{ width: '100%', marginTop: '8px' }}>
                    {loading ? 'Loading...' : 'Login'}
                  </button>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ width: '100%', fontSize: '13px' }} onClick={() => { setShowForgotPassword(true); setForgotStep('phone'); setError(''); setForgotMessage(''); }}>
                    Forgot password?
                  </button>
                </form>
              ) : forgotStep === 'phone' ? (
                <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                    Enter your registered phone number. A 6-digit verification code will be sent via SMS.
                  </p>
                  <div>
                    <label htmlFor="f-phone-number-3081" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Phone Number</label>
                    <input id="f-phone-number-3081" type="tel" required className="glass-input" placeholder="e.g. 0771234567" value={forgotIdentifier} onChange={e => setForgotIdentifier(e.target.value)} />
                  </div>
                  <button type="submit" className="glass-btn" disabled={loading} style={{ width: '100%' }}>
                    {loading ? 'Sending...' : 'Send Verification Code'}
                  </button>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ width: '100%', fontSize: '13px' }} onClick={() => { setShowForgotPassword(false); setError(''); setForgotMessage(''); setForgotIdentifier(''); }}>
                    <ArrowLeft className="icon" /> Back to Login
                  </button>
                </form>
              ) : (
                <form onSubmit={handleResetPasswordWithOtp} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                    Enter the 6-digit code sent to <strong>{forgotIdentifier}</strong>, then choose a new password.
                  </p>
                  {forgotMessage && (
                    <p style={{ fontSize: '13px', color: 'var(--accent-emerald)', margin: 0 }}>{forgotMessage}</p>
                  )}
                  <div>
                    <label htmlFor="f-verification-code-3100" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Verification Code</label>
                    <input id="f-verification-code-3100"
                      type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} required
                      className="glass-input" placeholder="123456" style={{ letterSpacing: '4px', fontWeight: 'bold', textAlign: 'center' }}
                      value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                  </div>
                  <div>
                    <label htmlFor="f-new-password-3108" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>New Password</label>
                    <input id="f-new-password-3108" type="password" required minLength={6} className="glass-input" placeholder="At least 6 characters" value={newPasswordOtp} onChange={e => setNewPasswordOtp(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="f-confirm-new-password-3112" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Confirm New Password</label>
                    <input id="f-confirm-new-password-3112" type="password" required minLength={6} className="glass-input" placeholder="Re-enter new password" value={confirmPasswordOtp} onChange={e => setConfirmPasswordOtp(e.target.value)} />
                  </div>
                  <button type="submit" className="glass-btn" disabled={loading} style={{ width: '100%' }}>
                    {loading ? 'Resetting...' : 'Reset Password'}
                  </button>
                  <button
                    type="button" className="glass-btn glass-btn-secondary" style={{ width: '100%', fontSize: '13px' }}
                    disabled={resendCooldown > 0 || loading} onClick={handleResendOtp}
                  >
                    {resendCooldown > 0 ? `Resend Code (${resendCooldown}s)` : 'Resend Code'}
                  </button>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ width: '100%', fontSize: '13px' }} onClick={handleBackToPhoneStep}>
                    <ArrowLeft className="icon" /> Use a Different Number
                  </button>
                </form>
              )}

            </div>
          </div>
        )}

        {/* ----------------- PORTAL SELECTOR ----------------- */}
        {token && user && view === 'portal' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '65vh', gap: '28px', padding: '20px' }}>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--accent-blue)', textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: '8px' }}>{orgSettings.org_name ? `${orgSettings.org_name.toUpperCase()} — UNIFIED PLATFORM` : 'UNIFIED PLATFORM'}</span>
              <h2 style={{ fontSize: '32px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>Welcome, {user.name}</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '6px' }}>Select a service portal below to proceed</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', width: '100%', maxWidth: '780px' }}>
              {user.finance_access !== false && (
                <div className="portal-card portal-card-blue" onClick={() => { setView('dashboard'); showToast('Entering Credit/Finance System'); }} style={{ cursor: 'pointer' }}>
                  <div className="portal-card-header">
                    <div className="portal-card-icon"><Landmark style={{ width: '28px', height: '28px' }} /></div>
                    <span className="portal-card-badge">Finance Portal</span>
                  </div>
                  <h3 className="portal-card-title">Credit & Loans</h3>
                  <p className="portal-card-desc">Manage cash disbursements, active loan files, daily agent collections, interest calculations, and double-entry accounting ledger reports.</p>
                  <div className="portal-card-action">Enter System &rarr;</div>
                </div>
              )}

              {user.ticket_access !== false && (
                <div className="portal-card portal-card-emerald" onClick={() => { setView('ticket-dashboard'); fetchTickets(); showToast('Entering Chit Fund/Ticket System'); }} style={{ cursor: 'pointer' }}>
                  <div className="portal-card-header">
                    <div className="portal-card-icon"><PiggyBank style={{ width: '28px', height: '28px' }} /></div>
                    <span className="portal-card-badge">Ticket Portal</span>
                  </div>
                  <h3 className="portal-card-title">Chit Fund Ledger</h3>
                  <p className="portal-card-desc">Create and run chit groups, calculate discounts/auctions, manage member registers, track payments per round, and generate Tamil WhatsApp notices.</p>
                  <div className="portal-card-action">Enter System &rarr;</div>
                </div>
              )}

              {user.role === 'admin' && user.pawn_access && (
                <div className="portal-card portal-card-amber" onClick={() => { setView('pawn-dashboard'); showToast('Entering Pawn Portal'); }} style={{ cursor: 'pointer' }}>
                  <div className="portal-card-header">
                    <div className="portal-card-icon"><Gem style={{ width: '28px', height: '28px' }} /></div>
                    <span className="portal-card-badge">Pawn Portal</span>
                  </div>
                  <h3 className="portal-card-title">Pawn Loans</h3>
                  <p className="portal-card-desc">Record vehicle and gold jewellery pawn loans, collect interest, extend due dates, return or forfeit items, and print the English or Tamil pawn ticket.</p>
                  <div className="portal-card-action">Enter System &rarr;</div>
                </div>
              )}
            </div>

            <button className="glass-btn glass-btn-secondary" style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '700', borderRadius: '12px', marginTop: '10px' }} onClick={handleLogout}>
              <LogOut style={{ width: '16px', height: '16px' }} /> Logout of Account
            </button>
          </div>
        )}

        {/* ----------------- PAWN PORTAL ----------------- */}
        {token && user && view === 'pawn-dashboard' && user.role === 'admin' && user.pawn_access && (
          <PawnPortal
            orgName={orgSettings.org_name}
            showToast={showToast}
            onBack={canSwitchPortals(user) ? () => setView('portal') : null}
          />
        )}

        {/* ----------------- TICKET PORTAL VIEWS ----------------- */}
        {token && user && view === 'ticket-dashboard' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Header / Group Selector list */}
            {!selectedTicket ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {canSwitchPortals(user) && (
                      <button className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px' }} onClick={() => setView('portal')}>
                        <ArrowLeft className="icon" /> Main Selector
                      </button>
                    )}
                    <div>
                      <h2 style={{ fontSize: '28px', margin: 0 }}>Ticket Groups Dashboard</h2>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Host-focused Chit Fund Management</span>
                    </div>
                  </div>
                  {user.role === 'admin' && (
                    <button className="glass-btn glass-btn-emerald" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '8px' }} onClick={() => setShowCreateTicket(true)}>
                      <Plus style={{ width: '16px', height: '16px' }} /> Create New Group
                    </button>
                  )}
                </div>

                {/* Create Ticket Group Modal */}
                {showCreateTicket && (
                  <div className="receipt-modal-overlay" onClick={() => setShowCreateTicket(false)}>
                    <div ref={createTicketModalRef} tabIndex={-1} className="glass-card" style={{ maxWidth: '540px', width: '90%', padding: '24px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ fontSize: '20px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><PiggyBank className="icon" /> Create New Chit Group</h3>
                        <button className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setShowCreateTicket(false)}>Close</button>
                      </div>
                      <form onSubmit={handleCreateTicket} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div>
                          <label htmlFor="f-ticket-group-name-3211" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Ticket Group Name *</label>
                          <input id="f-ticket-group-name-3211" required type="text" className="glass-input" placeholder="e.g. name of group" value={newTicketForm.name} onChange={e => setNewTicketForm(prev => ({ ...prev, name: e.target.value }))} />
                        </div>
                        <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                          <div>
                            <label htmlFor="f-total-value-lkr-3216" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Total Value (LKR) *</label>
                            <input id="f-total-value-lkr-3216" required type="number" inputMode="decimal" min="1" className="glass-input" placeholder="e.g. 300000" value={newTicketForm.total_value} onChange={e => setNewTicketForm(prev => ({ ...prev, total_value: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="f-member-count-3220" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Member Count *</label>
                            <input id="f-member-count-3220" required type="number" inputMode="numeric" min="2" className="glass-input" placeholder="e.g. 20" value={newTicketForm.member_count} onChange={e => setNewTicketForm(prev => ({ ...prev, member_count: e.target.value }))} />
                          </div>
                        </div>
                        <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                          <div>
                            <label htmlFor="f-start-date-3226" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Start Date *</label>
                            <input id="f-start-date-3226" required type="date" className="glass-input" value={newTicketForm.start_date} onChange={e => setNewTicketForm(prev => ({ ...prev, start_date: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="f-host-fee-calculation-3230" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Host Fee Calculation *</label>
                            <select id="f-host-fee-calculation-3230" className="glass-input" value={newTicketForm.host_fee_type} onChange={e => setNewTicketForm(prev => ({ ...prev, host_fee_type: e.target.value, host_fee_value: '' }))}>
                              <option value="percentage">Percentage (on original share)</option>
                              <option value="fixed">Fixed Fee (per member)</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>
                            {newTicketForm.host_fee_type === 'percentage' ? 'HOST FEE PERCENTAGE (%) *' : 'FIXED FEE AMOUNT PER MEMBER (LKR) *'}
                          </label>
                          <input required type="number" inputMode="decimal" step="0.01" min="0" className="glass-input" placeholder={newTicketForm.host_fee_type === 'percentage' ? 'e.g. 5.00' : 'e.g. 500'} value={newTicketForm.host_fee_value} onChange={e => setNewTicketForm(prev => ({ ...prev, host_fee_value: e.target.value }))} />
                        </div>
                        <div>
                          <label htmlFor="f-starting-round-optional-3244" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Starting Round (Optional)</label>
                          <input id="f-starting-round-optional-3244"
                            type="number" inputMode="numeric" min="1" max={newTicketForm.member_count || undefined}
                            className="glass-input" placeholder="Leave blank to start at round 1"
                            value={newTicketForm.starting_round}
                            onChange={e => setNewTicketForm(prev => ({ ...prev, starting_round: e.target.value }))}
                          />
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                            Only if this group already ran some rounds before you started using the app — e.g. already finished round 6 on paper, so enter 7 here. No history is recorded for the earlier rounds.
                          </span>
                        </div>

                        {/* Auto calculations display */}
                        {parseFloat(newTicketForm.total_value) > 0 && parseInt(newTicketForm.member_count, 10) > 0 && (
                          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '14px', fontSize: '13px' }}>
                            {(() => {
                              const val = parseFloat(newTicketForm.total_value);
                              const count = parseInt(newTicketForm.member_count, 10);
                              const share = val / count;
                              let fee = 0;
                              if (newTicketForm.host_fee_type === 'percentage') {
                                fee = share * ((parseFloat(newTicketForm.host_fee_value) || 0) / 100);
                              } else {
                                fee = parseFloat(newTicketForm.host_fee_value) || 0;
                              }
                              return (
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Original Share per Member:</span>
                                    <strong style={{ color: 'var(--accent-blue)' }}>LKR {share.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Host Fee collected per Member:</span>
                                    <strong>LKR {fee.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ width: '100%', padding: '12px', marginTop: '10px' }}>
                          Create Ticket Group
                        </button>
                      </form>
                    </div>
                  </div>
                )}

                {/* Groups Grid */}
                {ticketsList.length === 0 ? (
                  <div className="glass-card">
                    <div className="empty-state">
                      <div className="empty-state-icon"><PiggyBank style={{ width: '28px', height: '28px' }} /></div>
                      <h4 className="empty-state-title">No Ticket Groups Registered</h4>
                      <p className="empty-state-text">There are no Chit Fund groups created yet. Click "Create New Group" to initialize a ticket group schema.</p>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                    {ticketsList.map(t => {
                      const totalVal = parseFloat(t.total_value);
                      const originalShare = totalVal / t.member_count;
                      return (
                        <div key={t.id} className="glass-card" style={{ cursor: 'pointer', transition: 'transform 0.2s', padding: '24px', position: 'relative' }} onClick={() => fetchTicketDetails(t.id)}>
                          {user.role === 'admin' && (
                            <button
                              type="button"
                              className="glass-btn glass-btn-secondary"
                              style={{ position: 'absolute', top: '14px', right: '58px', padding: '5px 9px', fontSize: '11px' }}
                              onClick={(e) => openEditTicket(t, e)}
                              title={`Edit '${t.name}'`}
                              aria-label={`Edit ${t.name}`}
                            >
                              <Pencil className="icon" style={{ width: '13px', height: '13px' }} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="glass-btn glass-btn-rose"
                            style={{ position: 'absolute', top: '14px', right: '14px', padding: '5px 9px', fontSize: '11px' }}
                            onClick={(e) => handleDeleteTicket(t, e)}
                            title={`Delete '${t.name}'`}
                          >
                            <Trash2 className="icon" style={{ width: '13px', height: '13px' }} />
                          </button>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', paddingRight: '88px' }}>
                            <h3 style={{ fontSize: '18px', margin: 0, fontWeight: 'bold' }}>{t.name}</h3>
                            <span className={`status-pill ${t.status === 'active' ? 'status-pill-active' : 'status-pill-paid'}`}>
                              <span className="status-pill-dot" />{t.status === 'active' ? 'Active' : 'Completed'}
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                            <div>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block' }}>Total Ticket Value</span>
                              <span style={{ fontSize: '14px', fontWeight: '700' }}>LKR {totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block' }}>Member Count</span>
                              <span style={{ fontSize: '14px', fontWeight: '700' }}>{t.member_count} Members</span>
                            </div>
                            <div>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block' }}>Original Share</span>
                              <span style={{ fontSize: '14px', fontWeight: '700' }}>LKR {originalShare.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block' }}>Host Fee Rules</span>
                              <span style={{ fontSize: '13px', fontWeight: '600' }}>
                                {t.host_fee_type === 'percentage' ? `${t.host_fee_value}% Share` : `LKR ${parseFloat(t.host_fee_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Fixed`}
                              </span>
                            </div>
                          </div>

                          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            <span>Start: <strong>{new Date(t.start_date).toLocaleDateString()}</strong></span>
                            <span>Round: <strong style={{ color: 'var(--accent-blue)' }}>{t.status === 'completed' ? 'All Completed' : `${t.current_round} of ${t.member_count}`}</strong></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              /* Single Group Detail View */
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px' }} onClick={() => { setSelectedTicketIdState(null); setSelectedTicket(null); fetchTickets(); }}>
                    <ArrowLeft className="icon" /> Back to Groups List
                  </button>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {user.role === 'admin' && (
                      <>
                        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px', fontSize: '13px' }} onClick={() => openEditTicket(selectedTicket)}>
                          <Pencil className="icon" /> Edit Group
                        </button>
                        <button type="button" className="glass-btn glass-btn-rose" style={{ padding: '8px 14px', fontSize: '13px' }} onClick={(e) => handleDeleteTicket(selectedTicket, e, { leaveDetail: true })}>
                          <Trash2 className="icon" /> Delete Group
                        </button>
                      </>
                    )}
                    <span className="badge badge-active" style={{ background: 'var(--accent-emerald-light)', color: 'var(--accent-emerald)', padding: '6px 12px' }}>Total LKR {parseFloat(selectedTicket.total_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="glass-card" style={{ padding: '24px' }}>
                  <h2 style={{ fontSize: '26px', margin: '0 0 6px 0' }}>{selectedTicket.name}</h2>
                  <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <span>Members: <strong>{ticketMembers.length} / {selectedTicket.member_count}</strong></span>
                    <span>•</span>
                    <span>Start: <strong>{new Date(selectedTicket.start_date).toLocaleDateString()}</strong></span>
                    <span>•</span>
                    <span>Current Round: <strong style={{ color: 'var(--accent-blue)' }}>{selectedTicket.status === 'completed' ? 'Completed' : selectedTicket.current_round}</strong></span>
                    {selectedTicket.next_round_date && (
                      <>
                        <span>•</span>
                        <span style={{ color: 'var(--accent-gold)', fontWeight: 'bold' }}>Next Round Date: {new Date(selectedTicket.next_round_date).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Sub Tab Bar Selector */}
                <div className="subtab-pill-bar" style={{ display: 'flex', gap: '8px', overflowX: 'auto', borderBottom: '1px solid var(--border-light)', paddingBottom: '8px' }}>
                  <button type="button" className={`glass-btn ${activeTicketTab === 'auction' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} style={{ padding: '6px 14px', fontSize: '12px' }} onClick={() => setActiveTicketTab('auction')}>
                    <TrendingUp style={{ width: '14px', height: '14px', marginRight: '4px' }} /> Round Auction & Notice
                  </button>
                  <button type="button" className={`glass-btn ${activeTicketTab === 'members' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} style={{ padding: '6px 14px', fontSize: '12px' }} onClick={() => setActiveTicketTab('members')}>
                    <Users style={{ width: '14px', height: '14px', marginRight: '4px' }} /> Member Roster ({ticketMembers.length})
                  </button>
                  <button type="button" className={`glass-btn ${activeTicketTab === 'payments' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} style={{ padding: '6px 14px', fontSize: '12px' }} onClick={() => setActiveTicketTab('payments')}>
                    <CreditCard style={{ width: '14px', height: '14px', marginRight: '4px' }} /> Payments Tracker
                  </button>
                  <button type="button" className={`glass-btn ${activeTicketTab === 'history' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} style={{ padding: '6px 14px', fontSize: '12px' }} onClick={() => setActiveTicketTab('history')}>
                    <ScrollText style={{ width: '14px', height: '14px', marginRight: '4px' }} /> Past Auctions History ({ticketAuctions.length})
                  </button>
                </div>

                {/* Tab content renders */}
                {activeTicketTab === 'auction' && (
                  <div className="responsive-grid-2-col animate-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
                    {/* Run Auction panel */}
                    <div className="glass-card" style={{ padding: '24px' }}>
                      <h3 style={{ fontSize: '18px', marginBottom: '14px', fontWeight: 'bold' }}><TrendingUp className="icon" /> Run Round {selectedTicket.current_round} Auction</h3>
                      
                      {selectedTicket.status === 'completed' ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>This ticket group has completed all of its rounds.</p>
                      ) : (
                        <form onSubmit={handleRunTicketAuction} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <div>
                            <label htmlFor="f-bid-amount-discount-3437" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>BID AMOUNT (கழிவு / DISCOUNT) *</label>
                            <input id="f-bid-amount-discount-3437" required type="number" inputMode="decimal" min="0" max={parseFloat(selectedTicket.total_value)} className="glass-input" placeholder="e.g. 130000" value={auctionForm.bid_amount} onChange={e => setAuctionForm(prev => ({ ...prev, bid_amount: e.target.value }))} />
                          </div>

                          <div>
                            <label htmlFor="f-round-winner-3442" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Round Winner</label>
                            <select id="f-round-winner-3442" className="glass-input" value={auctionForm.winner_member_id} onChange={e => setAuctionForm(prev => ({ ...prev, winner_member_id: e.target.value }))}>
                              <option value="">-- No Winner Selected Yet --</option>
                              {ticketMembers.filter(m => !ticketAuctions.some(a => a.winner_member_id === m.id)).map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>Only shows members who haven't already won a previous round.</span>
                          </div>

                          <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div>
                              <label htmlFor="f-auction-date-3454" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Auction Date *</label>
                              <input id="f-auction-date-3454" required type="date" className="glass-input" value={auctionForm.auction_date} onChange={e => setAuctionForm(prev => ({ ...prev, auction_date: e.target.value }))} />
                            </div>
                            <div>
                              <label htmlFor="f-next-round-date-3458" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Next Round Date *</label>
                              <input id="f-next-round-date-3458" required type="date" className="glass-input" value={auctionForm.next_round_date} onChange={e => setAuctionForm(prev => ({ ...prev, next_round_date: e.target.value }))} />
                            </div>
                          </div>

                          {/* calculations preview */}
                          {parseFloat(auctionForm.bid_amount) >= 0 && (
                            <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '14px', fontSize: '13px' }}>
                              {(() => {
                                const totalVal = parseFloat(selectedTicket.total_value);
                                const bidVal = parseFloat(auctionForm.bid_amount) || 0;
                                const count = selectedTicket.member_count;
                                const payout = totalVal - bidVal;
                                const base = payout / count;
                                let fee = 0;
                                if (selectedTicket.host_fee_type === 'percentage') {
                                  fee = (totalVal / count) * ((parseFloat(selectedTicket.host_fee_value) || 0) / 100);
                                } else {
                                  fee = parseFloat(selectedTicket.host_fee_value) || 0;
                                }
                                const finalAmount = base + fee;
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span style={{ color: 'var(--text-secondary)' }}>Winner Payout:</span>
                                      <strong style={{ color: 'var(--accent-emerald)' }}>LKR {payout.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span style={{ color: 'var(--text-secondary)' }}>Base Payment per person:</span>
                                      <strong>LKR {base.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span style={{ color: 'var(--text-secondary)' }}>Host Fee per person:</span>
                                      <strong>LKR {fee.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-light)', paddingTop: '4px', marginTop: '4px' }}>
                                      <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>Repayment per member:</span>
                                      <strong style={{ color: 'var(--accent-blue)', fontSize: '14px' }}>LKR {finalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {user.role === 'admin' ? (
                            <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ width: '100%', padding: '12px' }}>
                              Submit Auction Round
                            </button>
                          ) : (
                            <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.05)', color: 'var(--accent-rose)', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold', textAlign: 'center' }}>
                              Only Admin hosts can submit auction rounds.
                            </div>
                          )}
                        </form>
                      )}
                    </div>

                    {/* WhatsApp Notice Panel */}
                    <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div>
                        <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}><MessageSquare className="icon" style={{ color: '#25D366' }} /> Tamil WhatsApp Notice</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px', marginBottom: 0 }}>Forward notice text directly to your WhatsApp group.</p>
                      </div>

                      {/* 1. Last Completed Round Notice */}
                      {ticketAuctions.length > 0 && (() => {
                        const lastAuction = ticketAuctions[ticketAuctions.length - 1];
                        const totalVal = parseFloat(selectedTicket.total_value);
                        const bidVal = parseFloat(lastAuction.bid_amount);
                        const payout = parseFloat(lastAuction.winner_payout);
                        const finalAmount = parseFloat(lastAuction.amount_per_member);
                        const roundNum = lastAuction.round_number;
                        const nextDateStr = selectedTicket.next_round_date 
                          ? new Date(selectedTicket.next_round_date).toLocaleDateString()
                          : '____________';

                        const noticeText = `ரூ ${totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                          `${roundNum}ம் சீட்டு கழிவு ரூ ${bidVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                          `💵 கிடைக்கும் தொகை:\n` +
                          `ரூ ${payout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                          `💳 கட்டு காசு:\n` +
                          `ரூ ${finalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                          `📅 ${roundNum + 1}ம் சீட்டு திகதி:\n` +
                          `${nextDateStr}`;

                        return (
                          <div style={{ border: '1px solid var(--border-light)', borderRadius: '12px', padding: '16px', background: 'rgba(255,255,255,0.02)' }}>
                            <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--accent-emerald)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>📢 Last Completed Round {roundNum} Notice</span>
                            <div style={{ background: '#075e54', color: 'white', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '13px', whiteSpace: 'pre-wrap', border: '1px solid #128c7e', marginBottom: '10px' }}>
                              {noticeText}
                            </div>
                            <button
                              type="button"
                              className="glass-btn"
                              style={{ width: '100%', padding: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', backgroundColor: '#25D366', color: 'white', border: 'none', fontWeight: 'bold', fontSize: '12px' }}
                              onClick={() => {
                                const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(noticeText)}`;
                                window.open(url, '_blank');
                              }}
                            >
                              <MessageSquare style={{ width: '14px', height: '14px' }} /> Share Round {roundNum} Notice to WhatsApp
                            </button>
                          </div>
                        );
                      })()}

                      {/* 2. Upcoming Round Draft Notice */}
                      {parseFloat(auctionForm.bid_amount) >= 0 && (() => {
                        const totalVal = parseFloat(selectedTicket.total_value);
                        const bidVal = parseFloat(auctionForm.bid_amount) || 0;
                        const count = selectedTicket.member_count;
                        const payout = totalVal - bidVal;
                        const base = payout / count;
                        let fee = 0;
                        if (selectedTicket.host_fee_type === 'percentage') {
                          fee = (totalVal / count) * ((parseFloat(selectedTicket.host_fee_value) || 0) / 100);
                        } else {
                          fee = parseFloat(selectedTicket.host_fee_value) || 0;
                        }
                        const finalAmount = base + fee;
                        const roundNum = selectedTicket.current_round;

                        const noticeText = `ரூ ${totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                          `${roundNum}ம் சீட்டு கழிவு ரூ ${bidVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                          `💵 கிடைக்கும் தொகை:\n` +
                          `ரூ ${payout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                          `💳 கட்டு காசு:\n` +
                          `ரூ ${finalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                          `📅 ${roundNum + 1}ம் சீட்டு திகதி:\n` +
                          `${auctionForm.next_round_date ? new Date(auctionForm.next_round_date).toLocaleDateString() : '____________'}`;

                        return (
                          <div style={{ border: '1px dashed var(--border-light)', borderRadius: '12px', padding: '16px', background: 'rgba(255,255,255,0.01)' }}>
                            <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>✏️ Next Round {roundNum} Draft Notice</span>
                            <div style={{ background: '#334155', color: 'white', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '13px', whiteSpace: 'pre-wrap', border: '1px solid var(--border-light)', marginBottom: '10px' }}>
                              {noticeText}
                            </div>
                            <button
                              type="button"
                              className="glass-btn glass-btn-secondary"
                              style={{ width: '100%', padding: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', fontSize: '12px' }}
                              onClick={() => {
                                const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(noticeText)}`;
                                window.open(url, '_blank');
                              }}
                            >
                              <MessageSquare style={{ width: '14px', height: '14px' }} /> Share Draft Notice to WhatsApp
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {activeTicketTab === 'members' && (
                  <div className="responsive-grid-2-col animate-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
                    {/* Roster list */}
                    <div className="glass-card" style={{ padding: '24px' }}>
                      <h3 style={{ fontSize: '18px', marginBottom: '14px', fontWeight: 'bold' }}><Users className="icon" /> Roster of Members</h3>
                      {ticketMembers.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No members added to this group yet.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border-light)', borderRadius: '12px', overflow: 'hidden' }}>
                          {ticketMembers.map((m, idx) => {
                            const wonAuction = ticketAuctions.find(a => a.winner_member_id === m.id);
                            return (
                              <div key={m.id} className="ticket-member-row">
                                <div>
                                  <strong style={{ display: 'block', fontSize: '14px' }}>{idx + 1}. {m.name}</strong>
                                  {m.phone && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                      <span><Phone className="icon" style={{ width: '12px', height: '12px' }} /> {m.phone}</span>
                                      <span className="quick-contact-actions" onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: '4px' }}>
                                        <a href={`tel:${m.phone}`} className="quick-contact-btn phone" title="Call Member" style={{ color: 'var(--accent-blue)' }}>
                                          <Phone style={{ width: '11px', height: '11px' }} />
                                        </a>
                                        <a href={`https://wa.me/${(m.phone || '').replace(/[^0-9]/g, '').startsWith('0') ? '94' + (m.phone || '').replace(/[^0-9]/g, '').slice(1) : (m.phone || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="quick-contact-btn whatsapp" title="Chat on WhatsApp" style={{ color: '#25D366' }}>
                                          <MessageSquare style={{ width: '11px', height: '11px' }} />
                                        </a>
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div>
                                  {wonAuction ? (
                                    <span className="badge badge-active" style={{ background: 'rgba(37, 84, 232, 0.1)', color: 'var(--accent-blue)', fontSize: '11px' }}>Won Round {wonAuction.round_number}</span>
                                  ) : (
                                    <span className="badge badge-defaulted" style={{ fontSize: '11px' }}>Not Won</span>
                                  )}
                                </div>
                                {user.role === 'admin' && (
                                  <div style={{ display: 'flex', gap: '6px', marginLeft: '10px' }}>
                                    <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '5px 9px', fontSize: '11px' }} onClick={() => openEditMember(m)} title={`Edit ${m.name}`} aria-label={`Edit ${m.name}`}>
                                      <Pencil className="icon" style={{ width: '13px', height: '13px' }} />
                                    </button>
                                    <button type="button" className="glass-btn glass-btn-rose" style={{ padding: '5px 9px', fontSize: '11px' }} onClick={() => handleRemoveTicketMember(m)} title={`Remove ${m.name}`} aria-label={`Remove ${m.name}`}>
                                      <Trash2 className="icon" style={{ width: '13px', height: '13px' }} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Add member form */}
                    <div className="glass-card" style={{ padding: '24px', alignSelf: 'flex-start' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                        <h3 style={{ fontSize: '18px', margin: 0, fontWeight: 'bold' }}><UserPlus className="icon" /> Add Member{memberAddMode === 'bulk' ? 's' : ''} to Group</h3>
                        {user.role === 'admin' && (
                          <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '9px', padding: '3px' }}>
                            {['single', 'bulk'].map(m => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setMemberAddMode(m)}
                                style={{
                                  padding: '5px 12px', fontSize: '12px', fontWeight: '700', textTransform: 'capitalize', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                  background: memberAddMode === m ? 'var(--accent-blue)' : 'transparent',
                                  color: memberAddMode === m ? '#fff' : 'var(--text-secondary)'
                                }}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {user.role !== 'admin' ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Only Admin hosts can add members to a group roster.</p>
                      ) : memberAddMode === 'single' ? (
                        <form onSubmit={handleAddTicketMember} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <div>
                            <label htmlFor="f-full-name-3686" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Full Name *</label>
                            <input id="f-full-name-3686" required type="text" className="glass-input" placeholder="e.g. S. Arulpragasam" value={newMemberForm.name} onChange={e => setNewMemberForm(prev => ({ ...prev, name: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="f-phone-number-3690" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Phone Number</label>
                            <input id="f-phone-number-3690" type="tel" className="glass-input" placeholder="e.g. 0771234567" value={newMemberForm.phone} onChange={e => setNewMemberForm(prev => ({ ...prev, phone: e.target.value }))} />
                          </div>
                          <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ width: '100%', padding: '12px' }}>
                            Add Member to Roster
                          </button>
                        </form>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                            One member per line — <code>Name, Phone</code> (phone is optional). Paste straight from a list or WhatsApp group export.
                          </p>
                          <textarea
                            className="glass-input"
                            style={{ minHeight: '160px', resize: 'vertical', fontFamily: 'monospace', fontSize: '13px' }}
                            placeholder={'S. Arulpragasam, 0771234567\nK. Thevi, 0779876543\nR. Kumar'}
                            value={bulkMemberText}
                            onChange={e => setBulkMemberText(e.target.value)}
                          />
                          <button type="button" className="glass-btn glass-btn-emerald" disabled={bulkAddingMembers || !bulkMemberText.trim()} style={{ width: '100%', padding: '12px' }} onClick={handleBulkAddMembers}>
                            {bulkAddingMembers ? 'Adding...' : `Add ${bulkMemberText.split('\n').map(l => l.trim()).filter(Boolean).length || ''} Member(s)`}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTicketTab === 'payments' && (
                  <div className="glass-card animate-fade-in" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                      <h3 style={{ fontSize: '18px', margin: 0, fontWeight: 'bold' }}><CreditCard className="icon" /> Repayments Collection Tracker</h3>
                      
                      {/* Round filter selector */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>View Round:</span>
                        <select className="glass-input" style={{ width: '110px', padding: '6px 12px' }} value={ticketPaymentFilterRound} onChange={e => { setTicketPaymentFilterRound(e.target.value); handleFetchTicketPaymentsByRound(e.target.value); }}>
                          {Array.from({ length: selectedTicket.status === 'completed' ? selectedTicket.member_count : selectedTicket.current_round - 1 }, (_, i) => i + 1).map(r => (
                            <option key={r} value={r}>Round {r}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {ticketPayments.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>No payments logged yet. Settle an auction round to generate payment logs.</p>
                    ) : (
                      <>
                        <div className="desktop-only" style={{ overflowX: 'auto' }}>
                          <table className="glass-table">
                            <thead>
                              <tr>
                                <th>Member Name</th>
                                <th>Contact</th>
                                <th>Amount Due</th>
                                <th>Collected?</th>
                                <th>Date Paid</th>
                                <th>Notify Reminder</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ticketPayments.map(p => {
                                const auction = ticketAuctions.find(a => a.round_number === p.round_number);
                                return (
                                  <tr key={p.id}>
                                    <td>
                                      <strong>{p.member_name}</strong>
                                    </td>
                                    <td>
                                      {p.member_phone ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <span>{p.member_phone}</span>
                                          <span className="quick-contact-actions" onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: '4px' }}>
                                            <a href={`tel:${p.member_phone}`} className="quick-contact-btn phone" title="Call" style={{ color: 'var(--accent-blue)' }}>
                                              <Phone style={{ width: '11px', height: '11px' }} />
                                            </a>
                                            <a href={`https://wa.me/${(p.member_phone || '').replace(/[^0-9]/g, '').startsWith('0') ? '94' + (p.member_phone || '').replace(/[^0-9]/g, '').slice(1) : (p.member_phone || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="quick-contact-btn whatsapp" style={{ color: '#25D366' }}>
                                              <MessageSquare style={{ width: '11px', height: '11px' }} />
                                            </a>
                                          </span>
                                        </div>
                                      ) : (
                                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                                      )}
                                    </td>
                                    <td style={{ fontWeight: 'bold' }}>LKR {auction ? parseFloat(auction.amount_per_member).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}</td>
                                    <td>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <input
                                          type="checkbox"
                                          checked={p.is_paid}
                                          onChange={() => handleToggleTicketPayment(p.id, !p.is_paid)}
                                          style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-emerald)' }}
                                        />
                                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: p.is_paid ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}>
                                          {p.is_paid ? 'Collected' : 'Pending'}
                                        </span>
                                      </label>
                                    </td>
                                    <td>{p.payment_date ? new Date(p.payment_date).toLocaleString() : '—'}</td>
                                    <td>
                                      {p.member_phone && !p.is_paid ? (
                                        <button className="glass-btn btn-whatsapp" style={{ padding: '6px 12px', fontSize: '11px' }} onClick={() => {
                                          const clean = (p.member_phone || '').replace(/[^0-9]/g, '');
                                          const int = clean.startsWith('0') ? '94' + clean.slice(1) : (clean.startsWith('94') ? clean : '94' + clean);
                                          const txt = `*${(orgSettings.org_name || 'CHIT FUND').toUpperCase()} - CHIT FUND PAYMENT REMINDER*\n\n` +
                                            `Group: *${selectedTicket.name}*\n` +
                                            `Round: *Round ${p.round_number}*\n` +
                                            `Amount Due: *LKR ${auction ? parseFloat(auction.amount_per_member).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}*\n\n` +
                                            `Please make your payment to the host. Thank you!`;
                                          window.open(`https://wa.me/${int}?text=${encodeURIComponent(txt)}`, '_blank');
                                        }}>
                                          Notify
                                        </button>
                                      ) : (
                                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile Checklist */}
                        <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {ticketPayments.map(p => {
                            const auction = ticketAuctions.find(a => a.round_number === p.round_number);
                            return (
                              <div key={p.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '14px', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <strong style={{ display: 'block', fontSize: '14px' }}>{p.member_name}</strong>
                                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    Due: <strong>LKR {auction ? parseFloat(auction.amount_per_member).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}</strong>
                                  </div>
                                  {p.member_phone && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}><Phone className="icon" style={{ width: '10px' }} /> {p.member_phone}</span>
                                      <span className="quick-contact-actions" style={{ display: 'flex', gap: '4px' }}>
                                        <a href={`tel:${p.member_phone}`} className="quick-contact-btn phone" title="Call" style={{ color: 'var(--accent-blue)' }}>
                                          <Phone style={{ width: '11px', height: '11px' }} />
                                        </a>
                                        <a href={`https://wa.me/${(p.member_phone || '').replace(/[^0-9]/g, '').startsWith('0') ? '94' + (p.member_phone || '').replace(/[^0-9]/g, '').slice(1) : (p.member_phone || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="quick-contact-btn whatsapp" style={{ color: '#25D366' }}>
                                          <MessageSquare style={{ width: '11px', height: '11px' }} />
                                        </a>
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
                                    <input
                                      type="checkbox"
                                      checked={p.is_paid}
                                      onChange={() => handleToggleTicketPayment(p.id, !p.is_paid)}
                                      style={{ width: '22px', height: '22px', accentColor: 'var(--accent-emerald)', cursor: 'pointer' }}
                                    />
                                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: p.is_paid ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}>
                                      {p.is_paid ? 'Collected' : 'Pending'}
                                    </span>
                                  </label>
                                  {p.member_phone && !p.is_paid && (
                                    <button className="glass-btn btn-whatsapp" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => {
                                      const clean = (p.member_phone || '').replace(/[^0-9]/g, '');
                                      const int = clean.startsWith('0') ? '94' + clean.slice(1) : (clean.startsWith('94') ? clean : '94' + clean);
                                      const txt = `*${(orgSettings.org_name || 'CHIT FUND').toUpperCase()} - CHIT FUND PAYMENT REMINDER*\n\n` +
                                        `Group: *${selectedTicket.name}*\n` +
                                        `Round: *Round ${p.round_number}*\n` +
                                        `Amount Due: *LKR ${auction ? parseFloat(auction.amount_per_member).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}*\n\n` +
                                        `Please make your payment to the host. Thank you!`;
                                      window.open(`https://wa.me/${int}?text=${encodeURIComponent(txt)}`, '_blank');
                                    }}>
                                      Notify
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeTicketTab === 'history' && (
                  <div className="glass-card animate-fade-in" style={{ padding: '24px' }}>
                    <h3 style={{ fontSize: '18px', marginBottom: '14px', fontWeight: 'bold' }}><ScrollText className="icon" /> Auctions & Rounds History Log</h3>
                    {ticketAuctions.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>No auction rounds completed yet.</p>
                    ) : (
                      <>
                        <div className="desktop-only" style={{ overflowX: 'auto' }}>
                          <table className="glass-table">
                            <thead>
                              <tr>
                                <th>Round #</th>
                                <th>Date</th>
                                <th>Bid (கழிவு)</th>
                                <th>Winner Member</th>
                                <th>Payout to Winner</th>
                                <th>Repayment / Member</th>
                                <th>Host Fee Collected</th>
                                {user.role === 'admin' && <th>Actions</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {ticketAuctions.map(a => (
                                <tr key={a.id}>
                                  <td style={{ fontWeight: 'bold' }}>Round {a.round_number}</td>
                                  <td>{new Date(a.auction_date).toLocaleDateString()}</td>
                                  <td style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}>LKR {parseFloat(a.bid_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td>
                                    {a.winner_name ? (
                                      <strong>{a.winner_name}</strong>
                                    ) : assigningWinnerFor === a.id ? (
                                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        <select className="glass-input" style={{ padding: '4px 6px', fontSize: '12px', width: '130px' }} value={assignWinnerMemberId} onChange={e => setAssignWinnerMemberId(e.target.value)}>
                                          <option value="">-- Select --</option>
                                          {ticketMembers.filter(m => !ticketAuctions.some(au => au.winner_member_id === m.id)).map(m => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                          ))}
                                        </select>
                                        <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => handleAssignAuctionWinner(a.id)}>Save</button>
                                        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => { setAssigningWinnerFor(null); setAssignWinnerMemberId(''); }}>✕</button>
                                      </div>
                                    ) : (
                                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <em style={{ color: 'var(--text-muted)' }}>N/A (No Winner)</em>
                                        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '2px 8px', fontSize: '10px' }} onClick={() => { setAssigningWinnerFor(a.id); setAssignWinnerMemberId(''); }}>Assign</button>
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ color: 'var(--accent-emerald)', fontWeight: 'bold' }}>LKR {parseFloat(a.winner_payout).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td>LKR {parseFloat(a.amount_per_member).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td>LKR {(parseFloat(a.host_fee_per_member) * selectedTicket.member_count).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  {user.role === 'admin' && (
                                    <td>
                                      <div style={{ display: 'flex', gap: '6px' }}>
                                        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => openEditRound(a)}><Pencil className="icon" style={{ width: '12px', height: '12px' }} /> Edit</button>
                                        {isLatestRound(a) && <button type="button" className="glass-btn glass-btn-rose" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => handleUndoRound(a)}><Undo2 className="icon" style={{ width: '12px', height: '12px' }} /> Undo</button>}
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="mobile-only mobile-card-list">
                          {ticketAuctions.map(a => (
                            <div key={a.id} className="mobile-row-card">
                              <div className="mobile-row-card-header">
                                <span className="mobile-row-card-title">Round {a.round_number}</span>
                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{new Date(a.auction_date).toLocaleDateString()}</span>
                              </div>
                              <div className="mobile-row-card-grid">
                                <span className="mobile-row-card-label">Winner</span>
                                {a.winner_name ? (
                                  <span className="mobile-row-card-value">{a.winner_name}</span>
                                ) : assigningWinnerFor === a.id ? (
                                  <span className="mobile-row-card-value" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                    <select className="glass-input" style={{ padding: '4px 6px', fontSize: '12px', flex: 1, minWidth: '110px' }} value={assignWinnerMemberId} onChange={e => setAssignWinnerMemberId(e.target.value)}>
                                      <option value="">-- Select --</option>
                                      {ticketMembers.filter(m => !ticketAuctions.some(au => au.winner_member_id === m.id)).map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                      ))}
                                    </select>
                                    <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => handleAssignAuctionWinner(a.id)}>Save</button>
                                    <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => { setAssigningWinnerFor(null); setAssignWinnerMemberId(''); }}>✕</button>
                                  </span>
                                ) : (
                                  <span className="mobile-row-card-value" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <em style={{ color: 'var(--text-muted)' }}>N/A</em>
                                    <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '2px 8px', fontSize: '10px' }} onClick={() => { setAssigningWinnerFor(a.id); setAssignWinnerMemberId(''); }}>Assign</button>
                                  </span>
                                )}

                                <span className="mobile-row-card-label">Bid (கழிவு)</span>
                                <span className="mobile-row-card-value" style={{ color: 'var(--accent-rose)' }}>LKR {parseFloat(a.bid_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>

                                <span className="mobile-row-card-label">Payout</span>
                                <span className="mobile-row-card-value" style={{ color: 'var(--accent-emerald)' }}>LKR {parseFloat(a.winner_payout).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>

                                <span className="mobile-row-card-label">Per Member</span>
                                <span className="mobile-row-card-value">LKR {parseFloat(a.amount_per_member).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>

                                <span className="mobile-row-card-label">Host Fee</span>
                                <span className="mobile-row-card-value">LKR {(parseFloat(a.host_fee_per_member) * selectedTicket.member_count).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>

                                {user.role === 'admin' && (
                                  <>
                                    <span className="mobile-row-card-label">Actions</span>
                                    <span className="mobile-row-card-value" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                      <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => openEditRound(a)}><Pencil className="icon" style={{ width: '12px', height: '12px' }} /> Edit</button>
                                      {isLatestRound(a) && <button type="button" className="glass-btn glass-btn-rose" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => handleUndoRound(a)}><Undo2 className="icon" style={{ width: '12px', height: '12px' }} /> Undo</button>}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}


            {/* ---- Edit chit group ---- */}
            {editTicketForm && (
              <div className="receipt-modal-overlay" onClick={() => setEditTicketForm(null)}>
                <div ref={editTicketModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Edit chit group" className="glass-card" style={{ maxWidth: '560px', width: '92%', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '20px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><Pencil className="icon" /> Edit Chit Group</h3>
                    <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setEditTicketForm(null)}>Close</button>
                  </div>
                  <form onSubmit={handleSaveTicketEdit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                      <label htmlFor="et-name" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Group Name *</label>
                      <input id="et-name" required type="text" maxLength={100} className="glass-input" value={editTicketForm.name} onChange={e => setEditTicketForm(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      <div>
                        <label htmlFor="et-total" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Total Value (LKR) *</label>
                        <input id="et-total" required type="number" inputMode="decimal" min="1" step="0.01" className="glass-input" value={editTicketForm.total_value} onChange={e => setEditTicketForm(p => ({ ...p, total_value: e.target.value }))} />
                      </div>
                      <div>
                        <label htmlFor="et-members" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Member Count *</label>
                        <input id="et-members" required type="number" inputMode="numeric" min={Math.max(1, editTicketForm.roundsRun, editTicketForm.rosterCount || 0)} className="glass-input" value={editTicketForm.member_count} onChange={e => setEditTicketForm(p => ({ ...p, member_count: e.target.value }))} />
                      </div>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '-6px' }}>
                      The member count is also the number of rounds. It can't go below the rounds already run ({editTicketForm.roundsRun}){editTicketForm.rosterCount !== null ? ` or the members on the roster (${editTicketForm.rosterCount})` : ' or the members already on the roster'}.
                    </span>
                    <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      <div>
                        <label htmlFor="et-start" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Start Date *</label>
                        <TypedDateInput id="et-start" required value={editTicketForm.start_date} onChange={e => setEditTicketForm(p => ({ ...p, start_date: e.target.value }))} />
                      </div>
                      <div>
                        <label htmlFor="et-next" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Next Round Date (optional)</label>
                        <TypedDateInput id="et-next" value={editTicketForm.next_round_date} onChange={e => setEditTicketForm(p => ({ ...p, next_round_date: e.target.value }))} />
                      </div>
                    </div>
                    <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      <div>
                        <label htmlFor="et-feetype" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Host Fee Calculation *</label>
                        <select id="et-feetype" className="glass-input" value={editTicketForm.host_fee_type} onChange={e => setEditTicketForm(p => ({ ...p, host_fee_type: e.target.value }))}>
                          <option value="percentage">Percentage (on original share)</option>
                          <option value="fixed">Fixed Fee (per member)</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="et-feeval" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>{editTicketForm.host_fee_type === 'percentage' ? 'Host Fee (%) *' : 'Fixed Fee (LKR) *'}</label>
                        <input id="et-feeval" required type="number" inputMode="decimal" step="0.01" min="0" className="glass-input" value={editTicketForm.host_fee_value} onChange={e => setEditTicketForm(p => ({ ...p, host_fee_value: e.target.value }))} />
                      </div>
                    </div>
                    <div role="note" style={{ background: 'var(--bg-tertiary)', borderLeft: '4px solid var(--accent-amber)', borderRadius: '8px', padding: '12px 14px', fontSize: '13px', lineHeight: 1.5 }}>
                      <strong>Changing the total value or host fee only affects rounds that haven't been run yet.</strong> Rounds already run keep the amounts that were collected. To redo a round that was run with wrong figures, use <em>Undo</em> on the latest round in Past Auctions History, then run it again.
                    </div>
                    {parseFloat(editTicketForm.total_value) > 0 && parseInt(editTicketForm.member_count, 10) > 0 && (() => {
                      const share = parseFloat(editTicketForm.total_value) / parseInt(editTicketForm.member_count, 10);
                      const fee = editTicketForm.host_fee_type === 'percentage' ? share * ((parseFloat(editTicketForm.host_fee_value) || 0) / 100) : (parseFloat(editTicketForm.host_fee_value) || 0);
                      return (
                        <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '14px', fontSize: '13px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span style={{ color: 'var(--text-secondary)' }}>Original share per member (new rounds):</span><strong style={{ color: 'var(--accent-blue)' }}>LKR {share.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Host fee per member (new rounds):</span><strong>LKR {fee.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></div>
                        </div>
                      );
                    })()}
                    {ticketDialogError && <div role="alert" style={{ color: 'var(--accent-rose)', fontSize: '14px' }}>{ticketDialogError}</div>}
                    <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ width: '100%', padding: '12px' }}>{loading ? 'Saving…' : 'Save Changes'}</button>
                  </form>
                </div>
              </div>
            )}

            {/* ---- Edit member ---- */}
            {editMemberForm && (
              <div className="receipt-modal-overlay" onClick={() => setEditMemberForm(null)}>
                <div ref={editMemberModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Edit member" className="glass-card" style={{ maxWidth: '440px', width: '92%', padding: '24px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '20px', margin: 0 }}>Edit Member</h3>
                    <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setEditMemberForm(null)}>Close</button>
                  </div>
                  <form onSubmit={handleSaveMemberEdit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                      <label htmlFor="em-name" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Full Name *</label>
                      <input id="em-name" required type="text" maxLength={100} className="glass-input" value={editMemberForm.name} onChange={e => setEditMemberForm(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor="em-phone" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Phone Number</label>
                      <input id="em-phone" type="tel" maxLength={20} className="glass-input" value={editMemberForm.phone} onChange={e => setEditMemberForm(p => ({ ...p, phone: e.target.value }))} />
                    </div>
                    {ticketDialogError && <div role="alert" style={{ color: 'var(--accent-rose)', fontSize: '14px' }}>{ticketDialogError}</div>}
                    <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ width: '100%', padding: '12px' }}>{loading ? 'Saving…' : 'Save Member'}</button>
                  </form>
                </div>
              </div>
            )}

            {/* ---- Edit round (winner / date) ---- */}
            {editRoundForm && (
              <div className="receipt-modal-overlay" onClick={() => setEditRoundForm(null)}>
                <div ref={editRoundModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Edit round" className="glass-card" style={{ maxWidth: '460px', width: '92%', padding: '24px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '20px', margin: 0 }}>Edit Round {editRoundForm.round_number}</h3>
                    <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setEditRoundForm(null)}>Close</button>
                  </div>
                  <form onSubmit={handleSaveRoundEdit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                      <label htmlFor="er-date" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Auction Date *</label>
                      <TypedDateInput id="er-date" required value={editRoundForm.auction_date} onChange={e => setEditRoundForm(p => ({ ...p, auction_date: e.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor="er-winner" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Round Winner</label>
                      <select id="er-winner" className="glass-input" value={editRoundForm.winner_member_id} onChange={e => setEditRoundForm(p => ({ ...p, winner_member_id: e.target.value }))}>
                        <option value="">— No winner yet —</option>
                        {ticketMembers.filter(m => m.id === editRoundForm.winner_member_id || !ticketAuctions.some(au => au.winner_member_id === m.id)).map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>Members who already won another round aren't listed. The bid and the amounts for this round don't change — to fix a wrong bid, undo the latest round and run it again.</span>
                    </div>
                    {ticketDialogError && <div role="alert" style={{ color: 'var(--accent-rose)', fontSize: '14px' }}>{ticketDialogError}</div>}
                    <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ width: '100%', padding: '12px' }}>{loading ? 'Saving…' : 'Save Round'}</button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ----------------- ADMIN PORTAL VIEWS ----------------- */}
        {token && user && user.role === 'admin' && adminData && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            
            {/* View 1: Main Grid Action Menu */}
            {view === 'dashboard' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                {/* KPI Metrics row */}
                <div className="kpi-grid-main" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>

                  {/* Card 0: Pending Approvals — only shown when there's something to review */}
                  {adminData.summary.pendingApprovalsCount > 0 && (
                    <div className="kpi-card" style={{ borderLeft: '4px solid var(--accent-amber)', cursor: 'pointer' }} onClick={() => setView('loans')}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <span className="kpi-lbl">Pending Approvals</span>
                          <h3 className="kpi-val" style={{ color: 'var(--accent-amber)' }}>
                            {adminData.summary.pendingApprovalsCount} Loan{adminData.summary.pendingApprovalsCount === 1 ? '' : 's'}
                          </h3>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                            Submitted by agents, awaiting your review
                          </span>
                        </div>
                        <div className="kpi-icon-bubble" style={{ background: '#fffbeb', color: '#b45309' }}>
                          <Clock style={{ width: '22px', height: '22px' }} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Card 1: Active Loans & Outstanding Principal */}
                  <div className="kpi-card kpi-card-blue">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span className="kpi-lbl">Active Loans</span>
                        <h3 className="kpi-val">{adminData.summary.totalActiveLoans}</h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                          Out Principal: <strong>LKR {adminData.summary.totalPrincipalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                        </span>
                      </div>
                      <div className="kpi-icon-bubble blue">
                        <ClipboardList style={{ width: '22px', height: '22px' }} />
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Total Disbursed */}
                  <div className="kpi-card kpi-card-blue">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span className="kpi-lbl">Total Disbursed</span>
                        <h3 className="kpi-val">LKR {adminData.summary.totalMoneyLent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                          Total Capital Issued
                        </span>
                      </div>
                      <div className="kpi-icon-bubble blue">
                        <Banknote style={{ width: '22px', height: '22px' }} />
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Collection Progress with Filter Selector */}
                  <div className="kpi-card kpi-card-emerald">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <span className="kpi-lbl">Collections Progress</span>
                      {/* Buttons were 3px/8px padding at 10px font — a ~20px
                          tall tap target for a toggle admins use constantly
                          to check today's collection vs the running total.
                          Sized up toward the usual comfortable minimum while
                          still fitting the KPI card header row. */}
                      <div style={{ display: 'flex', background: 'var(--bg-tertiary)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                        <button
                          type="button"
                          onClick={() => setCollectionSummaryMode('today')}
                          style={{
                            padding: '8px 14px', minHeight: '36px', fontSize: '13px', fontWeight: 'bold', borderRadius: '6px', border: 'none', cursor: 'pointer',
                            background: collectionSummaryMode === 'today' ? 'var(--accent-emerald)' : 'transparent',
                            color: collectionSummaryMode === 'today' ? '#fff' : 'var(--text-secondary)'
                          }}
                        >
                          Today
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollectionSummaryMode('all-time')}
                          style={{
                            padding: '8px 14px', minHeight: '36px', fontSize: '13px', fontWeight: 'bold', borderRadius: '6px', border: 'none', cursor: 'pointer',
                            background: collectionSummaryMode === 'all-time' ? 'var(--accent-emerald)' : 'transparent',
                            color: collectionSummaryMode === 'all-time' ? '#fff' : 'var(--text-secondary)'
                          }}
                        >
                          All-Time
                        </button>
                      </div>
                    </div>
                    {collectionSummaryMode === 'today' ? (
                      <div>
                        <h3 className="kpi-val" style={{ color: 'var(--accent-emerald)' }}>
                          LKR {(adminData.dailyReport?.collectionsToday || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                          Target Today: <strong>LKR {(adminData.summary.expectedTodayTarget || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                        </span>
                      </div>
                    ) : (
                      <div>
                        <h3 className="kpi-val" style={{ color: 'var(--accent-emerald)' }}>
                          LKR {adminData.summary.totalRepayments.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                          Total Cash Collected All-Time
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Card 4: Agent Cash in Hand */}
                  <div className="kpi-card kpi-card-blue">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span className="kpi-lbl">Agent Cash in Hand</span>
                        <h3 className="kpi-val" style={{ color: 'var(--accent-amber)' }}>
                          LKR {(adminData.summary.agentCashInHand || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                          Collected by agents, unremitted
                        </span>
                      </div>
                      <div className="kpi-icon-bubble" style={{ background: '#fef3c7', color: '#d97706' }}>
                        <Briefcase style={{ width: '22px', height: '22px' }} />
                      </div>
                    </div>
                  </div>

                  {/* Card 5: Overdue Loans Summary */}
                  <div className="kpi-card" style={{ borderLeft: '4px solid var(--accent-rose)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span className="kpi-lbl">Overdue Summary</span>
                        <h3 className="kpi-val" style={{ color: 'var(--accent-rose)' }}>
                          {adminData.summary.totalOverdue} Loans
                        </h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                          Overdue Balance: <strong>LKR {(adminData.summary.totalOverdueAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                        </span>
                      </div>
                      <div className="kpi-icon-bubble" style={{ background: '#ffe4e6', color: '#e11d48' }}>
                        <AlertTriangle style={{ width: '22px', height: '22px' }} />
                      </div>
                    </div>
                  </div>

                </div>

                {/* Pending loan applications awaiting admin review */}
                {adminData.pendingApprovals && adminData.pendingApprovals.length > 0 && (
                  <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-amber)' }}>
                    <h3 style={{ fontSize: '24px', marginBottom: '16px', color: 'var(--accent-amber)' }}><Clock className="icon" /> Loan Applications Awaiting Approval</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {adminData.pendingApprovals.map(loan => (
                        <div key={loan.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', padding: '14px 16px', background: 'var(--bg-primary)', border: '1px solid var(--border-light)', borderRadius: '12px' }}>
                          <div>
                            <strong style={{ display: 'block', fontSize: '15px' }}>{loan.borrower_name}</strong>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><Phone className="icon" /> {loan.borrower_phone}</span>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                              Submitted by <strong>{loan.submitted_by_name || 'Office'}</strong> · {new Date(loan.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '15px', fontWeight: '800', color: 'var(--accent-amber)' }}>LKR {parseFloat(loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <button className="glass-btn glass-btn-secondary" style={{ padding: '6px 14px', fontSize: '12px', fontWeight: '700' }} onClick={() => viewStatement(loan.id)}>
                              Review &rarr;
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Big Action Icon Buttons */}
                <h2 style={{ fontSize: '32px', textAlign: 'center', marginTop: '24px', marginBottom: '12px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                  What do you want to do?
                </h2>
                <div className="menu-card-grid">
                  
                  <div className="menu-card menu-card-give" role="button" tabIndex={0} aria-label="Give New Loan" onClick={() => setView('create-loan')} onKeyDown={(e) => handleCardKeyDown(e, () => setView('create-loan'))}>
                    <span className="menu-card-icon"><Banknote /></span>
                    <div>
                      <h3 style={{ fontSize: '26px', marginBottom: '10px', fontWeight: '800', color: 'var(--accent-emerald)' }}>Give New Loan</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '1.5' }}>Type borrower name and phone number to disburse cash instantly</p>
                    </div>
                  </div>

                  <div className="menu-card menu-card-give" role="button" tabIndex={0} aria-label="Next Day Tasklist" onClick={() => setView('next-day-tasklist')} onKeyDown={(e) => handleCardKeyDown(e, () => setView('next-day-tasklist'))}>
                    <span className="menu-card-icon"><Calendar /></span>
                    <div>
                      <h3 style={{ fontSize: '26px', marginBottom: '10px', fontWeight: '800', color: 'var(--accent-emerald)' }}>Next Day Tasklist</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '1.5' }}>View scheduled collections for tomorrow categorized by Daily, Weekly, and Monthly routes</p>
                    </div>
                  </div>

                  <div className="menu-card menu-card-check" role="button" tabIndex={0} aria-label="Record Payment" onClick={() => setView('record-payment')} onKeyDown={(e) => handleCardKeyDown(e, () => setView('record-payment'))}>
                    <span className="menu-card-icon"><CreditCard /></span>
                    <div>
                      <h3 style={{ fontSize: '26px', marginBottom: '10px', fontWeight: '800', color: 'var(--accent-blue)' }}>Record Payment</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '1.5' }}>Inline daily collection sheet: check full due or enter custom partial amounts (e.g. 200) on the same line</p>
                    </div>
                  </div>

                  <div className="menu-card menu-card-check" role="button" tabIndex={0} aria-label="Check Loans & Payments" onClick={() => setView('loans')} onKeyDown={(e) => handleCardKeyDown(e, () => setView('loans'))}>
                    <span className="menu-card-icon"><ClipboardList /></span>
                    <div>
                      <h3 style={{ fontSize: '26px', marginBottom: '10px', fontWeight: '800', color: 'var(--accent-blue)' }}>Check Loans & Payments</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '1.5' }}>Search and view customer accounts, balances, and ledger sheets</p>
                    </div>
                  </div>

                  <div className="menu-card menu-card-agent" role="button" tabIndex={0} aria-label="Agent Route Progress" onClick={() => setView('agents')} onKeyDown={(e) => handleCardKeyDown(e, () => setView('agents'))}>
                    <span className="menu-card-icon"><Users /></span>
                    <div>
                      <h3 style={{ fontSize: '26px', marginBottom: '10px', fontWeight: '800', color: '#7c3aed' }}>Agent Route Progress</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '1.5' }}>Check cash collections collected by your agents today</p>
                    </div>
                  </div>

                  <div className="menu-card menu-card-gold" role="button" tabIndex={0} aria-label="Interest Accrual Center" onClick={() => setView('interest-center')} onKeyDown={(e) => handleCardKeyDown(e, () => setView('interest-center'))}>
                    <span className="menu-card-icon"><TrendingUp /></span>
                    <div>
                      <h3 style={{ fontSize: '26px', marginBottom: '10px', fontWeight: '800', color: 'var(--accent-gold)' }}>Interest Accrual Center</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '1.5' }}>Revenue breakdown by collection frequency, formulas, and recent accrual logs</p>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* View: Interest Accrual & Formula Dashboard — pulled out of the
                dashboard home so it doesn't force every admin to scroll past
                a reporting page just to reach "What do you want to do?". */}
            {view === 'interest-center' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => setView('dashboard')}>
                  <ArrowLeft className="icon" /> Back to Main Menu
                </button>

                <div className="glass-card">
                  <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <TrendingUp className="icon" /> Interest Accrual & Calculations Center
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
                    Tracking automated interest accrued on active loans based on compounding frequencies.
                  </p>

                  <div className="responsive-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    {/* Totals by Frequency */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>Accrued Interest Revenue Breakdown</h3>
                      
                      {['daily', 'weekly', 'monthly'].map(freq => {
                        const freqTotal = adminData.interestByType?.find(i => i.interest_type === freq)?.total || 0;
                        const grandTotal = adminData.interestByType?.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0) || 1;
                        const percentage = Math.min(100, Math.round((parseFloat(freqTotal) / grandTotal) * 100)) || 0;
                        
                        return (
                          <div key={freq} style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-glass)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                              <span style={{ textTransform: 'capitalize', fontWeight: 'bold', fontSize: '14px' }}>{freq} Loans</span>
                              <strong style={{ color: 'var(--accent-gold)' }}>LKR {parseFloat(freqTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                            </div>
                            <div style={{ background: 'var(--bg-primary)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                              <div style={{ background: 'var(--accent-gold)', height: '100%', width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* How Calculations Work */}
                    <div style={{ padding: '16px', background: 'var(--bg-primary)', border: '1px solid var(--border-light)', borderRadius: '12px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}><BarChart3 className="icon" /> Interest Posting Formulas</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', lineHeight: '1.4' }}>
                        <div>
                          <strong style={{ color: 'var(--accent-blue)', display: 'block', marginBottom: '4px' }}>Daily Collection Formula:</strong>
                          <span style={{ color: 'var(--text-secondary)' }}><code>Daily Interest = (Principal × Rate / 100) / 30</code> accrued every 24h. Over 60 days = 2 months interest.</span>
                        </div>
                        <div>
                          <strong style={{ color: 'var(--accent-blue)', display: 'block', marginBottom: '4px' }}>Weekly Collection Formula:</strong>
                          <span style={{ color: 'var(--text-secondary)' }}><code>Weekly Interest = (Principal × Rate / 100) / 4</code> accrued every 7 days.</span>
                        </div>
                        <div>
                          <strong style={{ color: 'var(--accent-blue)', display: 'block', marginBottom: '4px' }}>Monthly Collection Formula:</strong>
                          <span style={{ color: 'var(--text-secondary)' }}><code>Monthly Interest = Principal × Rate / 100</code> accrued on calendar month dates (e.g. Mar 4th → Apr 4th → May 4th).</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Recent Accrual Logs */}
                  <div style={{ marginTop: '32px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>Recent Interest Accrual Logs</h3>
                    {!adminData.recentAccruals || adminData.recentAccruals.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No interest accrued yet.</p>
                    ) : (
                      <>
                        <div className="desktop-only" style={{ overflowX: 'auto' }}>
                          <table className="glass-table" style={{ fontSize: '14px' }}>
                            <thead>
                              <tr>
                                <th style={{ padding: '12px 16px', fontSize: '12px' }}>Borrower</th>
                                <th style={{ padding: '12px 16px', fontSize: '12px' }}>Accrual Date</th>
                                <th style={{ padding: '12px 16px', fontSize: '12px' }}>Accrued Amount</th>
                                <th style={{ padding: '12px 16px', fontSize: '12px' }}>Calculation Log (Formula Step)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {adminData.recentAccruals.map((acc, idx) => (
                                <tr key={idx} style={{ fontSize: '14px' }}>
                                  <td style={{ padding: '12px 16px' }}><strong>{acc.borrower_name}</strong></td>
                                  <td style={{ padding: '12px 16px' }}>{new Date(acc.created_at).toLocaleString()}</td>
                                  <td style={{ padding: '12px 16px', color: 'var(--accent-rose)', fontWeight: 'bold' }}>+LKR {parseFloat(acc.amount_accrued).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>{acc.calculation_log}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="mobile-only mobile-card-list">
                          {adminData.recentAccruals.map((acc, idx) => (
                            <div key={idx} className="mobile-row-card">
                              <div className="mobile-row-card-header">
                                <span className="mobile-row-card-title">{acc.borrower_name}</span>
                                <span style={{ color: 'var(--accent-rose)', fontWeight: 'bold', fontSize: '14px' }}>+LKR {parseFloat(acc.amount_accrued).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{new Date(acc.created_at).toLocaleString()}</span>
                              <div style={{ fontFamily: 'monospace', fontSize: '11.5px', color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '8px 10px', marginTop: '4px', wordBreak: 'break-word' }}>
                                {acc.calculation_log}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* View 3: Check Loans & ledger list */}
            {view === 'loans' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => setView('dashboard')}>
                    <ArrowLeft className="icon" /> Back to Main Menu
                  </button>
                  
                  {/* Small, non-intrusive Manual Accrual button trigger */}
                  <button className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }} onClick={handleForceAccrue} disabled={loading}>
                    <RefreshCcw className="icon" /> Update Interest Now
                  </button>
                </div>

                {/* Overdue loans card */}
                {adminData.overdueLoans.length > 0 && (
                  <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)' }}>
                    <h3 style={{ fontSize: '24px', marginBottom: '16px', color: 'var(--accent-rose)' }}><AlertTriangle className="icon" /> Overdue Accounts</h3>
                    
                    {/* Desktop View Table */}
                    <div className="desktop-only" style={{ overflowX: 'auto' }}>
                      <table className="glass-table">
                        <thead>
                          <tr>
                            <th>Borrower</th>
                            <th>Type</th>
                            <th>Principal</th>
                            <th>Rate</th>
                            <th>Outstanding</th>
                            <th>Accrual Date</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminData.overdueLoans.map(loan => (
                            <tr key={loan.id}>
                              <td>
                                <strong>{loan.borrower_name}</strong>
                                {loan.reference_number && (
                                  <span style={{ fontSize: '11px', color: 'var(--accent-blue)', background: 'rgba(59,130,246,0.1)', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px', fontWeight: 'bold' }}>
                                    {loan.reference_number}
                                  </span>
                                )}
                              </td>
                              <td style={{ textTransform: 'capitalize' }}>{loan.interest_type}</td>
                              <td>LKR {parseFloat(loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td>{loan.interest_rate}%</td>
                              <td style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}>
                                {loan.interest_type === 'daily' ? (
                                  <div>Total Outstanding: LKR {(parseFloat(loan.principal_outstanding || 0) + parseFloat(loan.interest_balance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                ) : (
                                  <>
                                    <div>Principal: LKR {parseFloat(loan.principal_outstanding).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                    <div style={{ fontSize: '12px', fontWeight: 'normal' }}>Interest due: LKR {parseFloat(loan.interest_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                  </>
                                )}
                              </td>
                              <td style={{ color: 'var(--accent-rose)' }}>
                                {new Date(loan.next_accrual_date).toLocaleDateString()}
                              </td>
                              <td>
                                <button className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '4px' }} onClick={() => viewStatement(loan.id)}>
                                  Check Account
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile View Cards */}
                    <div className="mobile-only mobile-card-list">
                      {adminData.overdueLoans.map(loan => (
                        <div 
                          key={loan.id} 
                          className="mobile-row-card mobile-row-card-danger"
                          onClick={() => viewStatement(loan.id)}
                          style={{ cursor: 'pointer', transition: 'transform 0.1s ease, box-shadow 0.1s ease' }}
                        >
                          <div className="mobile-row-card-header">
                            <span className="mobile-row-card-title">
                              {loan.borrower_name}
                              {loan.reference_number && (
                                <span style={{ fontSize: '10px', color: 'var(--accent-blue)', background: 'rgba(59,130,246,0.1)', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px', fontWeight: 'bold' }}>
                                  {loan.reference_number}
                                </span>
                              )}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="badge badge-defaulted">Overdue</span>
                              <span style={{ color: 'var(--text-muted)', display: 'flex' }}><ChevronRight /></span>
                            </div>
                          </div>
                          <div className="mobile-row-card-grid-compact">
                            <div>
                              <span className="mobile-row-card-label">Principal:</span>
                              <span className="mobile-row-card-value"> LKR {parseFloat(loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div>
                              <span className="mobile-row-card-label">Rate:</span>
                              <span className="mobile-row-card-value"> {loan.interest_rate}%</span>
                            </div>
                            <div>
                              <span className="mobile-row-card-label">Type:</span>
                              <span className="mobile-row-card-value" style={{ textTransform: 'capitalize' }}> {loan.interest_type}</span>
                            </div>
                            <div>
                              <span className="mobile-row-card-label">Accrual:</span>
                              <span className="mobile-row-card-value" style={{ color: 'var(--accent-rose)' }}> {new Date(loan.next_accrual_date).toLocaleDateString()}</span>
                            </div>
                            {loan.interest_type === 'daily' ? (
                              <div style={{ gridColumn: 'span 2' }}>
                                <span className="mobile-row-card-label">Total Outstanding:</span>
                                <span className="mobile-row-card-value" style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}> LKR {(parseFloat(loan.principal_outstanding || 0) + parseFloat(loan.interest_balance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>
                            ) : (
                              <>
                                <div>
                                  <span className="mobile-row-card-label">Principal Due:</span>
                                  <span className="mobile-row-card-value" style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}> LKR {parseFloat(loan.principal_outstanding).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                <div>
                                  <span className="mobile-row-card-label">Interest Due:</span>
                                  <span className="mobile-row-card-value" style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}> LKR {parseFloat(loan.interest_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                  </div>
                )}

                {/* All Active Loans list */}
                <LoansLoader onSelect={viewStatement} onQuickPay={viewStatement} fetchTrigger={adminData} />
              </div>
            )}

            {/* View 4: Agent Route Performance metrics */}
            {view === 'agents' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => setView('dashboard')}>
                    <ArrowLeft className="icon" /> Back to Main Menu
                  </button>
                </div>

                <div className="glass-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '26px', margin: 0 }}><TrendingUp className="icon" /> Agent Collections Today</h3>
                    <button
                      type="button"
                      className="glass-btn glass-btn-secondary"
                      style={{ padding: '8px 16px', fontSize: '12px' }}
                      disabled={adminData.agentPerformance.length === 0}
                      onClick={() => downloadCsv(
                        `agent-performance-${new Date().toISOString().slice(0, 10)}.csv`,
                        ['Agent', 'Total Collected (LKR)', 'Cash Deposits'],
                        adminData.agentPerformance.map(perf => [
                          perf.agent_name,
                          parseFloat(perf.total_collected).toFixed(2),
                          perf.collections_count
                        ])
                      )}
                    >
                      <Download className="icon" /> Export CSV
                    </button>
                  </div>
                  {adminData.agentPerformance.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '15px' }}>No collections posted by agents today.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      {adminData.agentPerformance.map((perf, i) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px' }}>
                            <span style={{ fontWeight: 'bold' }}>{perf.agent_name}</span>
                            <strong style={{ color: 'var(--accent-emerald)', fontSize: '18px' }}>LKR {parseFloat(perf.total_collected).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                          </div>
                          <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-light)', height: '14px', borderRadius: '7px', overflow: 'hidden' }}>
                            <div style={{ 
                              background: 'var(--accent-emerald)', 
                              height: '100%', 
                              width: `${Math.min(100, (parseFloat(perf.total_collected) / Math.max(...adminData.agentPerformance.map(p => parseFloat(p.total_collected) || 1))) * 100)}%` 
                            }} />
                          </div>
                          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{perf.collections_count} cash deposits successfully processed on assigned route</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* View 5: Cash & Tools — remittance verification, cash reconciliation, ledger report, user management */}
            {view === 'admin-tools' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => setView('dashboard')}>
                    <ArrowLeft className="icon" /> Back to Main Menu
                  </button>
                </div>

                {/* Users & Cash Tools bundles several unrelated admin
                    functions (cash reconciliation, remittances, the ledger
                    report, user management) — tabs keep each one a short,
                    focused screen instead of one long undifferentiated
                    scroll. Reuses the exact .loan-file-tabs/.loan-file-tab
                    pattern from the loan detail page for visual consistency
                    rather than inventing a second tab style. */}
                <div className="loan-file-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border-light)', gap: '8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  {[
                    { key: 'cash', label: 'Cash & Remittances', Icon: Briefcase },
                    { key: 'ledger', label: 'Ledger Report', Icon: BookOpen },
                    { key: 'users', label: 'User Management', Icon: User },
                    { key: 'reminders', label: 'Reminder Settings & Alerts', Icon: Bell }
                  ].map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      type="button"
                      className="loan-file-tab"
                      onClick={() => setAdminToolsTab(key)}
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        background: 'none',
                        border: 'none',
                        borderBottom: adminToolsTab === key ? '3px solid var(--accent-blue)' : '3px solid transparent',
                        color: adminToolsTab === key ? 'var(--accent-blue)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <Icon className="icon" style={{ fontSize: '16px' }} /> {label}
                    </button>
                  ))}
                </div>

                {adminToolsTab === 'cash' && (
                <>
                {/* Agent cash-in-hand reconciliation */}
                <div className="glass-card">
                  <h3 style={{ fontSize: '22px', marginBottom: '16px' }}><Briefcase className="icon" /> Agent Cash-in-Hand Reconciliation</h3>
                  {!cashReconciliation || cashReconciliation.agents.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No agents found.</p>
                  ) : (
                    <>
                      <div className="desktop-only" style={{ overflowX: 'auto' }}>
                        <table className="glass-table">
                          <thead>
                            <tr>
                              <th>Agent</th>
                              <th>Collected</th>
                              <th>Remitted</th>
                              <th>Cash in Hand</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cashReconciliation.agents.map(a => (
                              <tr key={a.agentId}>
                                <td style={{ fontWeight: 'bold' }}>{a.agentName}</td>
                                <td>LKR {a.totalCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td>LKR {a.totalRemitted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td style={{ fontWeight: 'bold', color: a.cashInHand > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
                                  LKR {a.cashInHand.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="mobile-only mobile-card-list">
                        {cashReconciliation.agents.map(a => (
                          <div key={a.agentId} className={`mobile-row-card ${a.cashInHand > 0 ? 'mobile-row-card-warning' : 'mobile-row-card-success'}`}>
                            <div className="mobile-row-card-header">
                              <span className="mobile-row-card-title">{a.agentName}</span>
                              <span className="mobile-row-card-value" style={{ fontWeight: 'bold', color: a.cashInHand > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
                                LKR {a.cashInHand.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="mobile-row-card-grid">
                              <span className="mobile-row-card-label">Collected</span>
                              <span className="mobile-row-card-value">LKR {a.totalCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>

                              <span className="mobile-row-card-label">Handed Over</span>
                              <span className="mobile-row-card-value">LKR {a.totalRemitted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Pending / recent handovers */}
                <div className="glass-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                    <h3 style={{ fontSize: '22px', margin: 0 }}><Truck className="icon" /> Cash Handovers</h3>
                    <button className="glass-btn glass-btn-secondary" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={downloadRemittancesCsv} disabled={remittances.length === 0}>
                      <Download className="icon" /> Export CSV
                    </button>
                  </div>
                  {/* Defaults to Pending — that's the actionable queue; this
                      list has no server-side date limit and grows forever,
                      so without a filter every verified/rejected handover
                      ever submitted buries the ones actually needing a
                      decision. */}
                  <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '3px', marginBottom: '16px' }}>
                    {['pending', 'verified', 'rejected', 'all'].map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setRemittanceStatusFilter(s)}
                        style={{
                          padding: '7px 14px', fontSize: '12px', fontWeight: '700', textTransform: 'capitalize', borderRadius: '7px', border: 'none', cursor: 'pointer',
                          background: remittanceStatusFilter === s ? 'var(--accent-blue)' : 'transparent',
                          color: remittanceStatusFilter === s ? '#fff' : 'var(--text-secondary)'
                        }}
                      >
                        {s} {s !== 'all' && `(${remittances.filter(r => r.status === s).length})`}
                      </button>
                    ))}
                  </div>
                  {remittances.filter(r => remittanceStatusFilter === 'all' || r.status === remittanceStatusFilter).length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No {remittanceStatusFilter !== 'all' ? remittanceStatusFilter : ''} cash handovers.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {remittances.filter(r => remittanceStatusFilter === 'all' || r.status === remittanceStatusFilter).map(r => (
                        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
                          <div>
                            <div style={{ fontWeight: 'bold' }}>{r.agent_name} — LKR {parseFloat(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{new Date(r.created_at).toLocaleString()} {r.notes ? `• ${r.notes}` : ''}</div>
                          </div>
                          {r.status === 'verified' ? (
                            <span className="badge badge-active">Verified</span>
                          ) : r.status === 'rejected' ? (
                            <span className="badge badge-defaulted" title={r.rejection_reason || ''}>Rejected</span>
                          ) : (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button className="glass-btn glass-btn-emerald" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={() => handleVerifyRemittance(r.id)} disabled={loading}>
                                Verify
                              </button>
                              <button className="glass-btn glass-btn-rose" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={() => handleRejectRemittance(r.id)} disabled={loading}>
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                </>
                )}

                {adminToolsTab === 'ledger' && (
                <>
                {/* Ledger / trial balance report */}
                <div className="glass-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                    <h3 style={{ fontSize: '22px' }}><BookOpen className="icon" /> Ledger / Trial Balance</h3>
                    <button className="glass-btn glass-btn-secondary" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={downloadLedgerCsv} disabled={!ledgerReport}>
                      <Download className="icon" /> Export CSV
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '16px' }}>
                    <div>
                      <label htmlFor="f-from-4694" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>From</label>
                      <input id="f-from-4694" type="date" className="glass-input" style={{ padding: '6px 10px' }} value={ledgerFrom} onChange={e => setLedgerFrom(e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="f-to-4698" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>To</label>
                      <input id="f-to-4698" type="date" className="glass-input" style={{ padding: '6px 10px' }} value={ledgerTo} onChange={e => setLedgerTo(e.target.value)} />
                    </div>
                    <button className="glass-btn glass-btn-secondary" style={{ padding: '7px 14px', fontSize: '12px' }} onClick={handleFetchLedgerReport} disabled={loading}>
                      Apply Range
                    </button>
                    {(ledgerFrom || ledgerTo) && (
                      <button className="glass-btn glass-btn-secondary" style={{ padding: '7px 14px', fontSize: '12px' }} onClick={() => { setLedgerFrom(''); setLedgerTo(''); handleFetchLedgerReport('', ''); }} disabled={loading}>
                        Clear (All-Time)
                      </button>
                    )}
                  </div>
                  {!ledgerReport ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading ledger report...</p>
                  ) : (
                    <>
                      <div className="desktop-only" style={{ overflowX: 'auto' }}>
                        <table className="glass-table">
                          <thead>
                            <tr>
                              <th>Account</th>
                              <th>Debit</th>
                              <th>Credit</th>
                              <th>Net</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ledgerReport.accounts.map(a => (
                              <tr key={a.account}>
                                <td style={{ fontWeight: 'bold' }}>{a.label}</td>
                                <td>LKR {a.debit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td>LKR {a.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td>LKR {a.net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border-light)', fontWeight: 'bold' }}>
                              <td>Totals</td>
                              <td>LKR {ledgerReport.totals.debit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td>LKR {ledgerReport.totals.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td style={{ color: ledgerReport.totals.balanced ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                                {ledgerReport.totals.balanced ? <><CircleCheck className="icon" /> Balanced</> : <><CircleAlert className="icon" /> Out of balance</>}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      <div className="mobile-only mobile-card-list">
                        {ledgerReport.accounts.map(a => (
                          <div key={a.account} className="mobile-row-card">
                            <div className="mobile-row-card-header">
                              <span className="mobile-row-card-title">{a.label}</span>
                              <span className="mobile-row-card-value" style={{ fontWeight: 'bold' }}>Net: LKR {a.net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div className="mobile-row-card-grid">
                              <span className="mobile-row-card-label">Debit</span>
                              <span className="mobile-row-card-value">LKR {a.debit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>

                              <span className="mobile-row-card-label">Credit</span>
                              <span className="mobile-row-card-value">LKR {a.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                        ))}
                        <div className={`mobile-row-card ${ledgerReport.totals.balanced ? 'mobile-row-card-success' : 'mobile-row-card-danger'}`}>
                          <div className="mobile-row-card-header">
                            <span className="mobile-row-card-title">Totals</span>
                            <span className="mobile-row-card-value" style={{ fontWeight: 'bold', color: ledgerReport.totals.balanced ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                              {ledgerReport.totals.balanced ? <><CircleCheck className="icon" /> Balanced</> : <><CircleAlert className="icon" /> Out of balance</>}
                            </span>
                          </div>
                          <div className="mobile-row-card-grid">
                            <span className="mobile-row-card-label">Debit</span>
                            <span className="mobile-row-card-value">LKR {ledgerReport.totals.debit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>

                            <span className="mobile-row-card-label">Credit</span>
                            <span className="mobile-row-card-value">LKR {ledgerReport.totals.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                </>
                )}

                {adminToolsTab === 'users' && (
                <>
                {/* User management */}
                <div className="glass-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '22px', margin: 0 }}><User className="icon" /> User Management</h3>
                    <button type="button" className="glass-btn" style={{ padding: '10px 18px', fontSize: '14px' }} onClick={() => setShowAddUser(v => !v)}>
                      <UserPlus className="icon" /> {showAddUser ? 'Cancel' : 'Add User'}
                    </button>
                  </div>

                  {showAddUser && (
                    <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '24px', padding: '18px', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', background: 'var(--bg-tertiary)' }}>
                      <div className="form-grid-2-col">
                        <div>
                          <label htmlFor="f-full-name-4800" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Full Name</label>
                          <input id="f-full-name-4800" required type="text" className="glass-input" value={newUserForm.name} onChange={e => setNewUserForm(prev => ({ ...prev, name: e.target.value }))} />
                        </div>
                        <div>
                          <label htmlFor="f-phone-number-4804" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Phone Number</label>
                          <input id="f-phone-number-4804" required type="tel" className="glass-input" placeholder="e.g. 0771234567" value={newUserForm.phone} onChange={e => setNewUserForm(prev => ({ ...prev, phone: e.target.value }))} />
                        </div>
                      </div>
                      <div className="form-grid-2-col">
                        <div>
                          <label htmlFor="f-email-optional-4810" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Email (Optional)</label>
                          <input id="f-email-optional-4810" type="email" className="glass-input" placeholder="e.g. name@example.com" value={newUserForm.email} onChange={e => setNewUserForm(prev => ({ ...prev, email: e.target.value }))} />
                        </div>
                      </div>
                      <div className="form-grid-2-col">
                        <div>
                          <label htmlFor="f-role-4816" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>ROLE</label>
                          <select id="f-role-4816" className="glass-input" value={newUserForm.role} onChange={e => setNewUserForm(prev => ({ ...prev, role: e.target.value }))}>
                            <option value="agent">Agent</option>
                            <option value="admin">Admin</option>
                            <option value="borrower">Borrower</option>
                          </select>
                        </div>
                        <div>
                          {newUserForm.role === 'borrower' ? (
                            <>
                              <label htmlFor="f-password-not-required-4826" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold', opacity: 0.5 }}>Password (Not Required)</label>
                              <input id="f-password-not-required-4826" disabled type="text" className="glass-input" placeholder="Borrowers have no login access" value="" />
                            </>
                          ) : (
                            <>
                              <label htmlFor="f-password-4831" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Password</label>
                              <input id="f-password-4831" required type="text" className="glass-input" placeholder="Set an initial password" value={newUserForm.password} onChange={e => setNewUserForm(prev => ({ ...prev, password: e.target.value }))} />
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '20px', margin: '4px 0 12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!newUserForm.finance_access} onChange={e => setNewUserForm(prev => ({ ...prev, finance_access: e.target.checked }))} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-blue)' }} />
                          Finance Portal Access
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!newUserForm.ticket_access} onChange={e => setNewUserForm(prev => ({ ...prev, ticket_access: e.target.checked }))} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-emerald)' }} />
                          Ticket Portal Access
                        </label>
                        {newUserForm.role === 'admin' && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!newUserForm.pawn_access} onChange={e => setNewUserForm(prev => ({ ...prev, pawn_access: e.target.checked }))} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-amber)' }} />
                            Pawn Portal Access
                          </label>
                        )}
                      </div>
                      <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ alignSelf: 'flex-start', padding: '10px 24px' }}>
                        <ClipboardCheck className="icon" /> Create User
                      </button>
                    </form>
                  )}

                  {/* Role filter — the list fetches admin/agent/borrower all
                      mixed together, which gets hard to scan once there are
                      more than a handful of users across all three roles. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Show:</span>
                    <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '3px' }}>
                      {['all', 'admin', 'agent', 'borrower'].map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setUserRoleFilter(r)}
                          style={{
                            padding: '7px 14px', fontSize: '12px', fontWeight: '700', textTransform: 'capitalize', borderRadius: '7px', border: 'none', cursor: 'pointer',
                            background: userRoleFilter === r ? 'var(--accent-blue)' : 'transparent',
                            color: userRoleFilter === r ? '#fff' : 'var(--text-secondary)'
                          }}
                        >
                          {r === 'all' ? 'All' : `${r}s`} {r !== 'all' && `(${adminUsers.filter(u => u.role === r).length})`}
                        </button>
                      ))}
                    </div>
                    <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
                      <Search style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: '14px', height: '14px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                      <input type="text" className="glass-input" placeholder="Search name, phone, email…" value={userSearchTerm} onChange={e => setUserSearchTerm(e.target.value)} style={{ paddingLeft: '32px', fontSize: '13px', width: '100%' }} />
                    </div>
                  </div>

                  <div className="desktop-only" style={{ overflowX: 'auto' }}>
                    <table className="glass-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Role</th>
                          <th>Contact</th>
                          <th>Permissions</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminUsers.filter(u => (userRoleFilter === 'all' || u.role === userRoleFilter) && (!userSearchTerm.trim() || [u.name, u.phone, u.email].some(f => (f || '').toLowerCase().includes(userSearchTerm.trim().toLowerCase())))).map(u => (
                          <tr key={u.id}>
                            <td style={{ fontWeight: 'bold' }}>{u.name}</td>
                            <td style={{ textTransform: 'capitalize' }}>{u.role}</td>
                            <td style={{ fontSize: '12px' }}>{u.phone}</td>
                            <td>
                              <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ color: u.finance_access !== false ? 'var(--accent-blue)' : 'var(--text-muted)', fontWeight: u.finance_access !== false ? '600' : '400' }}>Finance: {u.finance_access !== false ? 'Yes' : 'No'}</span>
                                <span style={{ color: u.ticket_access !== false ? 'var(--accent-emerald)' : 'var(--text-muted)', fontWeight: u.ticket_access !== false ? '600' : '400' }}>Ticket: {u.ticket_access !== false ? 'Yes' : 'No'}</span>
                                {u.role === 'admin' && <span style={{ color: u.pawn_access ? 'var(--accent-amber)' : 'var(--text-muted)', fontWeight: u.pawn_access ? '600' : '400' }}>Pawn: {u.pawn_access ? 'Yes' : 'No'}</span>}
                              </div>
                            </td>
                            <td>
                              <span className={`badge ${u.is_active ? 'badge-active' : 'badge-defaulted'}`}>{u.is_active ? 'Active' : 'Inactive'}</span>
                            </td>
                            <td style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              <button className="glass-btn glass-btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => handleToggleUserStatus(u)} disabled={loading || u.id === user.id}>
                                {u.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                              <button className="glass-btn glass-btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => handleStartEditUser(u)} disabled={loading}>
                                Edit Details
                              </button>
                              {u.role !== 'borrower' && (
                                <button className="glass-btn glass-btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => handleResetUserPassword(u)} disabled={loading} title="Sends a verification code to this user's phone — they set their own new password with it.">
                                  Send Reset Code
                                </button>
                              )}
                              <button className="glass-btn glass-btn-rose" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => handleDeleteUser(u)} disabled={loading || u.id === user.id}>
                                <Trash2 className="icon" /> Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mobile-only mobile-card-list">
                    {adminUsers.filter(u => (userRoleFilter === 'all' || u.role === userRoleFilter) && (!userSearchTerm.trim() || [u.name, u.phone, u.email].some(f => (f || '').toLowerCase().includes(userSearchTerm.trim().toLowerCase())))).map(u => (
                      <div key={u.id} className="mobile-row-card">
                        <div className="mobile-row-card-header">
                          <span className="mobile-row-card-title">{u.name}</span>
                          <span className={`badge ${u.is_active ? 'badge-active' : 'badge-defaulted'}`}>{u.is_active ? 'Active' : 'Inactive'}</span>
                        </div>
                        <div className="mobile-row-card-grid">
                          <span className="mobile-row-card-label">Role</span>
                          <span className="mobile-row-card-value" style={{ textTransform: 'capitalize' }}>{u.role}</span>

                          <span className="mobile-row-card-label">Phone</span>
                          <span className="mobile-row-card-value">{u.phone}</span>
                        </div>
                        <div className="mobile-row-card-actions">
                          <button className="glass-btn glass-btn-secondary" onClick={() => handleToggleUserStatus(u)} disabled={loading || u.id === user.id}>
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button className="glass-btn glass-btn-secondary" onClick={() => handleStartEditUser(u)} disabled={loading}>
                            Edit Details
                          </button>
                          {u.role !== 'borrower' && (
                            <button className="glass-btn glass-btn-secondary" onClick={() => handleResetUserPassword(u)} disabled={loading} title="Sends a verification code to this user's phone — they set their own new password with it.">
                              Send Reset Code
                            </button>
                          )}
                          <button className="glass-btn glass-btn-rose" onClick={() => handleDeleteUser(u)} disabled={loading || u.id === user.id}>
                            <Trash2 className="icon" /> Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                </>
                )}

                {adminToolsTab === 'reminders' && (
                  <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
                      <div>
                        <h3 style={{ fontSize: '22px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Bell className="icon" style={{ color: 'var(--accent-amber)' }} /> Reminder Settings & Alert Controls
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
                          Weekly/monthly borrowers get a proactive SMS before their interest is due (below). Daily-installment loans work differently — borrower, agent, and admin are all alerted automatically once a loan falls 3+ days behind on its expected daily collection, repeating every day it stays unresolved.
                        </p>
                      </div>
                    </div>

                    {/* Setting Form */}
                    <div style={{ padding: '18px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '12px', marginBottom: '24px', maxWidth: '520px' }}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        REMIND BEFORE DUE DATE (DAYS)
                      </label>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          className="glass-input"
                          value={overdueDaysThreshold}
                          onChange={e => setOverdueDaysThreshold(e.target.value === '' ? '' : parseInt(e.target.value, 10) || 1)}
                          onBlur={e => handleUpdateOverdueThreshold(e.target.value)}
                          style={{ width: '120px', padding: '10px', fontSize: '16px', fontWeight: 'bold' }}
                        />
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>days before the due date</span>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '8px' }}>
                        Weekly/monthly borrowers get a one-time SMS reminder exactly {overdueDaysThreshold} day{overdueDaysThreshold === 1 ? '' : 's'} before their next interest payment is due — e.g. with this set to 1, a loan due June 2nd gets its reminder on June 1st. Doesn't apply to daily-installment loans (see above).
                      </span>
                    </div>

                    {/* Overdue Loans Table — a separate, manual "what's
                        currently overdue right now" review list (days since
                        last accrual), distinct from the proactive
                        before-due-date reminder configured above. */}
                    <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>
                      Active Loans Overdue ({MANUAL_OVERDUE_REVIEW_DAYS}+ Days Since Last Accrual)
                    </h4>
                    {(() => {
                      const now = new Date();
                      const overdueLoansList = (adminData.overdueLoans || []).filter(l => {
                        if (l.status !== 'active') return false;
                        const lastAcc = l.last_accrual_date ? new Date(l.last_accrual_date) : new Date(l.created_at);
                        const diffDays = Math.floor((now - lastAcc) / (1000 * 60 * 60 * 24));
                        return diffDays >= MANUAL_OVERDUE_REVIEW_DAYS;
                      });

                      if (overdueLoansList.length === 0) {
                        return (
                          <div className="empty-state">
                            <div className="empty-state-icon"><CircleCheck style={{ width: '28px', height: '28px', color: 'var(--accent-emerald)' }} /></div>
                            <h4 className="empty-state-title">No Loans Past {MANUAL_OVERDUE_REVIEW_DAYS} Days Overdue</h4>
                            <p className="empty-state-text">All active customer accounts are up to date within the configured threshold.</p>
                          </div>
                        );
                      }

                      // Actually calls the backend now — this used to just
                      // show a toast claiming an SMS had gone out without
                      // sending anything, which meant clicking it told the
                      // admin a borrower had been reminded when nothing had
                      // actually happened.
                      const sendAlert = async (l) => {
                        try {
                          const result = await api.post(`/loans/${l.id}/send-reminder`);
                          showToast(result.smsSent
                            ? `Sent SMS reminder to ${l.borrower_name} (${l.borrower_phone}).`
                            : `Logged for ${l.borrower_name} — no SMS sent (daily/flat-installment loan).`);
                        } catch (err) {
                          showToast(err.message || 'Could not send the reminder.', 'error');
                        }
                      };

                      return (
                        <>
                          <div className="desktop-only" style={{ overflowX: 'auto' }}>
                            <table className="glass-table">
                              <thead>
                                <tr>
                                  <th>Loan Ref ID</th>
                                  <th>Borrower</th>
                                  <th>Category</th>
                                  <th>Uncollected Interest</th>
                                  <th>Days Overdue</th>
                                  <th>Collector</th>
                                  <th>Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {overdueLoansList.map(l => {
                                  const lastAcc = l.last_accrual_date ? new Date(l.last_accrual_date) : new Date(l.created_at);
                                  const diffDays = Math.floor((now - lastAcc) / (1000 * 60 * 60 * 24));
                                  return (
                                    <tr key={l.id}>
                                      <td style={{ fontWeight: 'bold' }}>{l.reference_number || `LN-${String(l.id).padStart(3, '0')}`}</td>
                                      <td>
                                        <strong>{l.borrower_name}</strong>
                                        <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)' }}>{l.borrower_phone}</span>
                                      </td>
                                      <td style={{ textTransform: 'capitalize' }}>{l.interest_type}</td>
                                      <td style={{ fontWeight: 'bold', color: 'var(--accent-rose)' }}>LKR {parseFloat(l.interest_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                      <td>
                                        <span className="badge badge-defaulted">{diffDays} Days Overdue</span>
                                      </td>
                                      <td>{l.agent_name || 'Office Staff'}</td>
                                      <td>
                                        <button
                                          className="glass-btn glass-btn-secondary"
                                          style={{ padding: '6px 10px', fontSize: '12px' }}
                                          onClick={() => sendAlert(l)}
                                        >
                                          Send Alert
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Mobile card view — this table's 7 columns
                              (including an action button) previously only
                              rendered as a cramped horizontal-scroll table
                              on phones, same class of issue as the Next-Day
                              Tasklist above. */}
                          <div className="mobile-only mobile-card-list">
                            {overdueLoansList.map(l => {
                              const lastAcc = l.last_accrual_date ? new Date(l.last_accrual_date) : new Date(l.created_at);
                              const diffDays = Math.floor((now - lastAcc) / (1000 * 60 * 60 * 24));
                              return (
                                <div key={l.id} className="mobile-row-card mobile-row-card-danger">
                                  <div className="mobile-row-card-header">
                                    <span className="mobile-row-card-title">{l.borrower_name}</span>
                                    <span className="badge badge-defaulted">{diffDays}d overdue</span>
                                  </div>
                                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{l.borrower_phone} · {l.reference_number || `LN-${String(l.id).padStart(3, '0')}`}</span>
                                  <div className="mobile-row-card-grid">
                                    <span className="mobile-row-card-label">Category</span>
                                    <span className="mobile-row-card-value" style={{ textTransform: 'capitalize' }}>{l.interest_type}</span>

                                    <span className="mobile-row-card-label">Uncollected</span>
                                    <span className="mobile-row-card-value" style={{ color: 'var(--accent-rose)' }}>LKR {parseFloat(l.interest_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>

                                    <span className="mobile-row-card-label">Collector</span>
                                    <span className="mobile-row-card-value">{l.agent_name || 'Office Staff'}</span>
                                  </div>
                                  <div className="mobile-row-card-actions">
                                    <button className="glass-btn glass-btn-secondary" style={{ flex: '1 1 100%' }} onClick={() => sendAlert(l)}>
                                      Send Alert
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Edit User Modal (Admin only) */}
                {editingUser && (
                  <div className="receipt-modal-overlay" onClick={() => setEditingUser(null)}>
                    <div ref={editingUserModalRef} tabIndex={-1} className="receipt-modal-card" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ fontSize: '20px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><User className="icon" /> Edit User Details</h3>
                        <button className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setEditingUser(null)}>
                          Close
                        </button>
                      </div>
                      <form onSubmit={handleUpdateUser} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div>
                          <label htmlFor="f-full-name-5145" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Full Name</label>
                          <input id="f-full-name-5145" required type="text" className="glass-input" value={editUserForm.name} onChange={e => setEditUserForm(prev => ({ ...prev, name: e.target.value }))} />
                        </div>
                        <div>
                          <label htmlFor="f-phone-number-5149" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Phone Number</label>
                          <input id="f-phone-number-5149" required type="tel" className="glass-input" value={editUserForm.phone} onChange={e => setEditUserForm(prev => ({ ...prev, phone: e.target.value }))} />
                        </div>
                        <div>
                          <label htmlFor="f-email-optional-5153" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Email (Optional)</label>
                          <input id="f-email-optional-5153" type="email" className="glass-input" value={editUserForm.email || ''} onChange={e => setEditUserForm(prev => ({ ...prev, email: e.target.value }))} />
                        </div>
                        <div>
                          <label htmlFor="f-role-5157" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>ROLE</label>
                          <select id="f-role-5157" className="glass-input" value={editUserForm.role} onChange={e => setEditUserForm(prev => ({ ...prev, role: e.target.value }))} disabled={editingUser.id === user.id}>
                            <option value="agent">Agent</option>
                            <option value="admin">Admin</option>
                            <option value="borrower">Borrower</option>
                          </select>
                          {editingUser.id === user.id && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>You cannot change your own role.</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '20px', marginTop: '4px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!editUserForm.finance_access} onChange={e => setEditUserForm(prev => ({ ...prev, finance_access: e.target.checked }))} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-blue)' }} />
                            Finance Portal Access
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!editUserForm.ticket_access} onChange={e => setEditUserForm(prev => ({ ...prev, ticket_access: e.target.checked }))} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-emerald)' }} />
                            Ticket Portal Access
                          </label>
                          {editUserForm.role === 'admin' && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                              <input type="checkbox" checked={!!editUserForm.pawn_access} onChange={e => setEditUserForm(prev => ({ ...prev, pawn_access: e.target.checked }))} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-amber)' }} />
                              Pawn Portal Access
                            </label>
                          )}
                        </div>
                        <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ width: '100%', padding: '12px', marginTop: '10px' }}>
                          <ClipboardCheck className="icon" /> Save Changes
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}

            {view === 'audit-log' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => setView('dashboard')}>
                    <ArrowLeft className="icon" /> Back to Main Menu
                  </button>
                </div>
                <AuditLogLoader />
              </div>
            )}

            {view === 'sms-log' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => setView('dashboard')}>
                    <ArrowLeft className="icon" /> Back to Main Menu
                  </button>
                </div>
                <SmsLogLoader />
              </div>
            )}

            {view === 'payment-history' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => setView('dashboard')}>
                    <ArrowLeft className="icon" /> Back to Main Menu
                  </button>
                </div>
                <PaymentHistoryLoader />
              </div>
            )}

            {view === 'record-payment' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => setView('dashboard')}>
                    <ArrowLeft className="icon" /> Back to Main Menu
                  </button>
                </div>
                <RecordDailyPaymentsTab loans={[]} onRefresh={fetchDashboardData} showToast={showToast} />
              </div>
            )}

            {view === 'next-day-tasklist' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => setView('dashboard')}>
                    <ArrowLeft className="icon" /> Back to Main Menu
                  </button>
                </div>
                <NextDayTasklistTab loans={[]} onSelectLoan={(id) => { setSelectedLoanId(id); setView('loans'); }} onNavigateRecordPayment={() => setView('record-payment')} />
              </div>
            )}

            {view === 'borrower-intakes' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => setView('dashboard')}>
                    <ArrowLeft className="icon" /> Back to Main Menu
                  </button>
                </div>
                <BorrowerIntakesLoader onConvert={handleConvertIntakeToLoan} onCountChange={setPendingIntakeCount} showToast={showToast} />
              </div>
            )}

          </div>
        )}

            {token && user && (user.role === 'admin' || user.role === 'agent') && view === 'create-loan' && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ fontSize: '15px', fontWeight: 'bold' }} onClick={() => {
                    setView('dashboard');
                    setGiveLoanStep(1);
                  }}>
                    <ArrowLeft className="icon" /> Back to Main Menu
                  </button>
                </div>

                <div className="glass-card" style={{ maxWidth: '900px', margin: '0 auto', width: '100%', padding: '0', overflow: 'hidden' }}>
                  <div className="wizard-layout">
                    {/* Stepper Navigation Sidebar */}
                    <div className="wizard-sidebar">
                      <h4 className="wizard-title" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', margin: '0 0 10px', fontWeight: 'bold' }}>LOAN WIZARD</h4>
                      
                      <div className="wizard-progress-bar" style={{ height: '4px', background: 'var(--border-light)', borderRadius: '2px', margin: '8px 0 16px', overflow: 'hidden' }}>
                        <div className="wizard-progress-bar-fill" style={{ height: '100%', background: 'var(--accent-blue)', transition: 'width 0.3s ease', width: `${(giveLoanStep / (includeGuarantor ? 4 : 3)) * 100}%` }} />
                      </div>

                      <div className="wizard-step-nodes-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <button type="button" 
                          className={`step-indicator ${giveLoanStep === 1 ? 'active' : 'completed'}`}
                          onClick={() => setGiveLoanStep(1)}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', gap: '12px', alignItems: 'center', textAlign: 'left', width: '100%' }}
                        >
                          <div className="step-number" style={{ width: '28px', height: '28px', borderRadius: '50%', background: giveLoanStep > 1 ? 'var(--accent-emerald)' : 'var(--accent-blue)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>
                            {giveLoanStep > 1 ? <Check style={{ width: '16px', height: '16px' }} /> : '1'}
                          </div>
                          <div>
                            <div className="step-label" style={{ fontWeight: '700', fontSize: '14px' }}>KYC Profile</div>
                            <span className="step-subtext" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Identity & DOB</span>
                          </div>
                        </button>

                        <button type="button" 
                          className={`step-indicator ${giveLoanStep === 2 ? 'active' : giveLoanStep > 2 ? 'completed' : ''}`}
                          onClick={() => { if (runKYCValidation()) setGiveLoanStep(2); }}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', gap: '12px', alignItems: 'center', textAlign: 'left', width: '100%' }}
                        >
                          <div className="step-number" style={{ width: '28px', height: '28px', borderRadius: '50%', background: giveLoanStep > 2 ? 'var(--accent-emerald)' : (giveLoanStep === 2 ? 'var(--accent-blue)' : 'var(--border-strong)'), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>
                            {giveLoanStep > 2 ? <Check style={{ width: '16px', height: '16px' }} /> : '2'}
                          </div>
                          <div>
                            <div className="step-label" style={{ fontWeight: '700', fontSize: '14px' }}>Financial Profile</div>
                            <span className="step-subtext" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Earnings & Family</span>
                          </div>
                        </button>

                        <button type="button" 
                          className={`step-indicator ${giveLoanStep === 3 ? 'active' : giveLoanStep > 3 ? 'completed' : ''}`}
                          onClick={() => { if (runKYCValidation() && runFinancialValidation()) setGiveLoanStep(3); }}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', gap: '12px', alignItems: 'center', textAlign: 'left', width: '100%' }}
                        >
                          <div className="step-number" style={{ width: '28px', height: '28px', borderRadius: '50%', background: giveLoanStep > 3 ? 'var(--accent-emerald)' : (giveLoanStep === 3 ? 'var(--accent-blue)' : 'var(--border-strong)'), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>
                            {giveLoanStep > 3 ? <Check style={{ width: '16px', height: '16px' }} /> : '3'}
                          </div>
                          <div>
                            <div className="step-label" style={{ fontWeight: '700', fontSize: '14px' }}>Loan Terms</div>
                            <span className="step-subtext" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Interest & Agent</span>
                          </div>
                        </button>

                        {includeGuarantor && (
                          <button type="button" 
                            className={`step-indicator ${giveLoanStep === 4 ? 'active' : ''}`}
                            onClick={() => { if (runKYCValidation() && runFinancialValidation() && runTermsValidation()) setGiveLoanStep(4); }}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', gap: '12px', alignItems: 'center', textAlign: 'left', width: '100%' }}
                          >
                            <div className="step-number" style={{ width: '28px', height: '28px', borderRadius: '50%', background: giveLoanStep === 4 ? 'var(--accent-blue)' : 'var(--border-strong)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>
                              4
                            </div>
                            <div>
                              <div className="step-label" style={{ fontWeight: '700', fontSize: '14px' }}>Guarantor Info</div>
                              <span className="step-subtext" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Security Backup</span>
                            </div>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Wizard Body / Form Content */}
                    <div className="wizard-body">
                      <h3 style={{ fontSize: '28px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Banknote className="icon" style={{ color: 'var(--accent-blue)', fontSize: '24px' }} /> Give New Loan
                      </h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                        STEP {giveLoanStep} OF {includeGuarantor ? '4' : '3'}: {' '}
                        {giveLoanStep === 1 && "Borrower Identity & KYC Details"}
                        {giveLoanStep === 2 && "Borrower Financial Profile & Spouse Info"}
                        {giveLoanStep === 3 && "Scheduling, Accrual terms, and Agent Assignment"}
                        {giveLoanStep === 4 && "Guarantor security backing verification"}
                      </p>

                      <form noValidate onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {giveLoanStep === 1 && (
                          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* --- SECTION 1: BORROWER DETAILS --- */}
                            <div style={{ border: '1px solid var(--border-glass)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                              <p style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', margin: '0', fontSize: '15px' }}>
                                <User className="icon" /> 1. BORROWER PERSONAL DETAILS (KYC)
                              </p>
                              
                              <div>
                                <label htmlFor="borrower_name" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Borrower Name *</label>
                                <input id="borrower_name" type="text" className="glass-input" style={{ borderColor: validationErrors.borrower_name ? 'var(--accent-rose)' : '', borderWidth: validationErrors.borrower_name ? '2px' : '' }} placeholder="e.g. Bandara Perera" value={newLoan.borrower_name} onChange={e => { setNewLoan(prev => ({ ...prev, borrower_name: e.target.value })); clearFieldError('borrower_name'); }} />
                                {validationErrors.borrower_name && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.borrower_name}</span>}
                              </div>

                              <div>
                                <label htmlFor="borrower_phone" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Borrower Mobile Number (Sri Lanka) *</label>
                                <input id="borrower_phone" type="tel" className="glass-input" style={{ borderColor: validationErrors.borrower_phone ? 'var(--accent-rose)' : '', borderWidth: validationErrors.borrower_phone ? '2px' : '' }} placeholder="e.g. 0771234567 or +94771234567" value={newLoan.borrower_phone} onChange={e => { setNewLoan(prev => ({ ...prev, borrower_phone: e.target.value })); clearFieldError('borrower_phone'); }} />
                                {validationErrors.borrower_phone && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.borrower_phone}</span>}
                              </div>

                              <div>
                                <label htmlFor="borrower_address" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Borrower Address (Optional)</label>
                                <input id="borrower_address" type="text" className="glass-input" style={{ borderColor: validationErrors.borrower_address ? 'var(--accent-rose)' : '', borderWidth: validationErrors.borrower_address ? '2px' : '' }} placeholder="e.g. No. 12, Temple Road, Kandy" value={newLoan.borrower_address} onChange={e => { setNewLoan(prev => ({ ...prev, borrower_address: e.target.value })); clearFieldError('borrower_address'); }} />
                                {validationErrors.borrower_address && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.borrower_address}</span>}
                              </div>

                              <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                <div>
                                  <label htmlFor="f-borrower-email-optional-5369" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Borrower Email (Optional)</label>
                                  <input id="f-borrower-email-optional-5369" type="email" className="glass-input" placeholder="e.g. name@example.com" value={newLoan.borrower_email || ''} onChange={e => setNewLoan(prev => ({ ...prev, borrower_email: e.target.value }))} />
                                </div>
                                <div>
                                  <label htmlFor="date_of_birth" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Date of Birth (Optional)</label>
                                  <TypedDateInput id="date_of_birth" error={!!validationErrors.date_of_birth} value={newLoan.date_of_birth} onChange={e => { setNewLoan(prev => ({ ...prev, date_of_birth: e.target.value })); clearFieldError('date_of_birth'); }} />
                                  {validationErrors.date_of_birth && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.date_of_birth}</span>}
                                </div>
                              </div>

                              <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                <div>
                                  <label htmlFor="nic_number" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>NIC Number *</label>
                                  <input id="nic_number" type="text" className="glass-input" style={{ borderColor: validationErrors.nic_number ? 'var(--accent-rose)' : '', borderWidth: validationErrors.nic_number ? '2px' : '' }} placeholder="e.g. 199012345678 or 123456789V" value={newLoan.nic_number} onChange={e => { setNewLoan(prev => ({ ...prev, nic_number: e.target.value })); clearFieldError('nic_number'); }} onBlur={e => runNicLookup('borrower', e.target.value)} />
                                  {validationErrors.nic_number && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.nic_number}</span>}
                                  {nicLookup.borrower?.loading && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>Checking record…</span>}
                                  {renderNicLookupWarning('borrower')}
                                </div>
                                <div>
                                  <label htmlFor="f-nic-photo-newloan-nic-photos-length-0-0--5388" id="nic_photos" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>NIC Photo (Optional) {(newLoan.nic_photos?.length || 0) > 0 && `(${newLoan.nic_photos.length}/${MAX_KYC_PHOTOS})`}</label>
                                  <input id="f-nic-photo-newloan-nic-photos-length-0-0--5388" type="file" accept="image/*" multiple className="glass-input" style={{ borderColor: validationErrors.nic_photos ? 'var(--accent-rose)' : '', borderWidth: validationErrors.nic_photos ? '2px' : '' }} onChange={e => { handleNICPhotoChange(e); clearFieldError('nic_photos'); }} disabled={(newLoan.nic_photos?.length || 0) >= MAX_KYC_PHOTOS} />
                                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Up to {MAX_KYC_PHOTOS} photos.</p>
                                  {(newLoan.nic_photos?.length || 0) > 0 && (
                                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                      {newLoan.nic_photos.map((photo, idx) => (
                                        <div key={idx} style={{ position: 'relative' }}>
                                          <img src={photo} alt={`NIC preview ${idx + 1}`} style={{ width: '52px', height: '38px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-glass)' }} />
                                          <button type="button" onClick={() => removeNICPhoto(idx)} title="Remove" style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: '50%', background: 'var(--accent-rose)', color: '#fff', border: 'none', fontSize: '11px', lineHeight: 1, cursor: 'pointer' }}>×</button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {validationErrors.nic_photos && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.nic_photos}</span>}
                                </div>
                              </div>

                              <div>
                                <label htmlFor="f-photo-proof-e-g-utility-bill-or-other-id-5406" id="photo_proofs" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Photo Proof (Optional — e.g. utility bill or other ID evidence) {(newLoan.photo_proofs?.length || 0) > 0 && `(${newLoan.photo_proofs.length}/${MAX_KYC_PHOTOS})`}</label>
                                <input id="f-photo-proof-e-g-utility-bill-or-other-id-5406" type="file" accept="image/*" multiple className="glass-input" style={{ borderColor: validationErrors.photo_proofs ? 'var(--accent-rose)' : '', borderWidth: validationErrors.photo_proofs ? '2px' : '' }} onChange={e => { handleAddressProofChange(e); clearFieldError('photo_proofs'); }} disabled={(newLoan.photo_proofs?.length || 0) >= MAX_KYC_PHOTOS} />
                                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Up to {MAX_KYC_PHOTOS} photos.</p>
                                {(newLoan.photo_proofs?.length || 0) > 0 && (
                                  <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    {newLoan.photo_proofs.map((photo, idx) => (
                                      <div key={idx} style={{ position: 'relative' }}>
                                        <img src={photo} alt={`Photo proof preview ${idx + 1}`} style={{ width: '52px', height: '38px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-glass)' }} />
                                        <button type="button" onClick={() => removePhotoProof(idx)} title="Remove" style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: '50%', background: 'var(--accent-rose)', color: '#fff', border: 'none', fontSize: '11px', lineHeight: 1, cursor: 'pointer' }}>×</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {validationErrors.photo_proofs && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.photo_proofs}</span>}
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
                              <button 
                                type="button" 
                                className="glass-btn glass-btn-secondary" 
                                onClick={() => { if (runKYCValidation()) setGiveLoanStep(3); }}
                                style={{ flex: '1 1 140px', padding: '14px', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                              >
                                <Zap className="icon" style={{ color: 'var(--accent-amber)' }} /> Fast Terms (Skip Step 2)
                              </button>
                              <button 
                                type="button" 
                                className="glass-btn glass-btn-emerald" 
                                onClick={() => handleWizardNext(1)}
                                style={{ flex: '1 1 180px', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px' }}
                              >
                                Continue to Step 2 <ArrowRight className="icon" />
                              </button>
                            </div>
                          </div>
                        )}

                        {giveLoanStep === 2 && (
                          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* --- SECTION 2: BORROWER PROFILE DETAILS --- */}
                            <div style={{ border: '1px solid var(--border-glass)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                              <p style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', margin: '0', fontSize: '15px' }}>
                                <ClipboardList className="icon" /> 2. BORROWER PROFILE DETAILS
                              </p>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div>
                                  <label htmlFor="loan_purpose" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Purpose of Loan (Optional)</label>
                                  <input id="loan_purpose" type="text" className="glass-input" style={{ borderColor: validationErrors.loan_purpose ? 'var(--accent-rose)' : '', borderWidth: validationErrors.loan_purpose ? '2px' : '' }} placeholder="e.g. Business working capital, home repair" value={borrowerProfileForm.loan_purpose} onChange={e => { setBorrowerProfileForm(prev => ({ ...prev, loan_purpose: e.target.value })); clearFieldError('loan_purpose'); }} />
                                  {validationErrors.loan_purpose && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.loan_purpose}</span>}
                                </div>

                                <div>
                                  <label htmlFor="monthly_income" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Monthly Income (LKR) (Optional)</label>
                                  <input id="monthly_income" type="number" min="0" className="glass-input" style={{ borderColor: validationErrors.monthly_income ? 'var(--accent-rose)' : '', borderWidth: validationErrors.monthly_income ? '2px' : '' }} value={borrowerProfileForm.monthly_income} onChange={e => { setBorrowerProfileForm(prev => ({ ...prev, monthly_income: e.target.value })); clearFieldError('monthly_income'); }} />
                                  {validationErrors.monthly_income && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.monthly_income}</span>}
                                </div>

                                <p style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-secondary)', margin: '4px 0 -4px' }}>Spouse Details (if applicable)</p>
                                <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                  <div>
                                    <label htmlFor="f-spouse-name-5458" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Spouse Name</label>
                                    <input id="f-spouse-name-5458" type="text" className="glass-input" value={borrowerProfileForm.spouse_name} onChange={e => setBorrowerProfileForm(prev => ({ ...prev, spouse_name: e.target.value }))} />
                                  </div>
                                  <div>
                                    <label htmlFor="f-spouse-nic-number-5462" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Spouse NIC Number</label>
                                    <input id="f-spouse-nic-number-5462" type="text" className="glass-input" value={borrowerProfileForm.spouse_nic} onChange={e => setBorrowerProfileForm(prev => ({ ...prev, spouse_nic: e.target.value }))} />
                                  </div>
                                </div>
                                <div>
                                  <label htmlFor="f-spouse-occupation-5467" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Spouse Occupation</label>
                                  <input id="f-spouse-occupation-5467" type="text" className="glass-input" value={borrowerProfileForm.spouse_occupation} onChange={e => setBorrowerProfileForm(prev => ({ ...prev, spouse_occupation: e.target.value }))} />
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px' }}>
                              <button type="button" className="glass-btn glass-btn-secondary" onClick={() => handleWizardBack(2)} style={{ flex: 1, padding: '16px' }}>Back</button>
                              <button type="button" className="glass-btn glass-btn-emerald" onClick={() => handleWizardNext(2)} style={{ flex: 2, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                Continue to Terms <ArrowRight className="icon" />
                              </button>
                            </div>
                          </div>
                        )}

                        {giveLoanStep === 3 && (
                          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* --- SECTION 3: LOAN DETAILS & TERMS --- */}
                            <div style={{ border: '1px solid var(--border-glass)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                              <p style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', margin: '0', fontSize: '15px' }}>
                                <Landmark className="icon" /> 3. LOAN SCHEDULING DETAILS
                              </p>

                              <div>
                                <label htmlFor="principal_amount" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Principal Amount (LKR) *</label>
                                <input id="principal_amount" type="number" min="1" className="glass-input" style={{ borderColor: validationErrors.principal_amount ? 'var(--accent-rose)' : '', borderWidth: validationErrors.principal_amount ? '2px' : '' }} placeholder="e.g. 50000" value={newLoan.principal_amount} onChange={e => { setNewLoan(prev => ({ ...prev, principal_amount: e.target.value })); clearFieldError('principal_amount'); }} />
                                {validationErrors.principal_amount && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.principal_amount}</span>}
                              </div>

                              <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                <div>
                                  <label htmlFor="interest_rate" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Interest Rate (%) *</label>
                                  <input id="interest_rate" type="number" step="0.01" min="0" className="glass-input" style={{ borderColor: validationErrors.interest_rate ? 'var(--accent-rose)' : '', borderWidth: validationErrors.interest_rate ? '2px' : '' }} placeholder="2.00" value={newLoan.interest_rate} onChange={e => { setNewLoan(prev => ({ ...prev, interest_rate: e.target.value })); clearFieldError('interest_rate'); }} />
                                  {validationErrors.interest_rate && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.interest_rate}</span>}
                                </div>
                                <div>
                                  <label htmlFor="f-accrual-frequency-5503" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Accrual Frequency</label>
                                  <select id="f-accrual-frequency-5503" required className="glass-input" value={newLoan.interest_type} onChange={e => setNewLoan(prev => ({ ...prev, interest_type: e.target.value }))}>
                                    <option value="daily">Daily Accumulation</option>
                                    <option value="weekly">Weekly Accumulation</option>
                                    <option value="monthly">Monthly Accumulation</option>
                                  </select>
                                </div>
                              </div>

                              {user.role !== 'agent' && (
                                <div>
                                  <label htmlFor="f-disbursement-date-5514" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Issued Date (Disbursement Date)</label>
                                  <TypedDateInput id="f-disbursement-date-5514"
                                    value={newLoan.disbursement_date || todayLocalDateStr()}
                                    onChange={e => setNewLoan(prev => ({ ...prev, disbursement_date: e.target.value }))}
                                  />
                                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    Defaults to today. Set an earlier date to register a loan that was actually handed out in the past — interest/collections will be backdated to match.
                                  </p>
                                </div>
                              )}

                              <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                <div>
                                  <label htmlFor="f-loan-term-5530" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Loan Term</label>
                                  <select id="f-loan-term-5530" required className="glass-input" value={newLoan.collection_mode} onChange={e => setNewLoan(prev => ({ ...prev, collection_mode: e.target.value }))}>
                                    <option value="open_ended">Open-Ended (Runs until fully paid)</option>
                                    <option value="fixed_term">Fixed Term (Set duration)</option>
                                  </select>
                                </div>
                                {newLoan.collection_mode === 'fixed_term' && (
                                  <div>
                                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>
                                      {newLoan.interest_type === 'daily'
                                        ? 'DURATION (days) — 31 = 1 month, 62 = 2 months, 93 = 3 months *'
                                        : `DURATION (in ${newLoan.interest_type === 'weekly' ? 'weeks' : 'months'}) *`}
                                    </label>
                                    <input id="duration_periods" type="number" min="1" required className="glass-input" style={{ borderColor: validationErrors.duration_periods ? 'var(--accent-rose)' : '', borderWidth: validationErrors.duration_periods ? '2px' : '' }} placeholder={newLoan.interest_type === 'daily' ? 'e.g. 31, 62, or 93' : 'e.g. 30'} value={newLoan.duration_periods} onChange={e => { setNewLoan(prev => ({ ...prev, duration_periods: e.target.value })); clearFieldError('duration_periods'); }} />
                                    {newLoan.interest_type === 'daily' && (
                                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                                        {[31, 62, 93].map(d => (
                                          <button key={d} type="button" className={`glass-btn ${String(newLoan.duration_periods) === String(d) ? 'glass-btn-emerald' : 'glass-btn-secondary'}`} style={{ padding: '5px 12px', fontSize: '12px' }} onClick={() => { setNewLoan(prev => ({ ...prev, duration_periods: String(d) })); clearFieldError('duration_periods'); }}>
                                            {d} days ({d === 31 ? '1' : d === 62 ? '2' : '3'} mo)
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    {validationErrors.duration_periods && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors.duration_periods}</span>}
                                  </div>
                                )}
                              </div>

                              {newLoan.interest_type === 'daily' && newLoan.collection_mode === 'fixed_term'
                                ? (newLoan.principal_amount > 0 && newLoan.interest_rate > 0 && parseInt(newLoan.duration_periods, 10) > 0 && parseInt(newLoan.duration_periods, 10) % 31 === 0) && (() => {
                                    const p = parseFloat(newLoan.principal_amount) || 0;
                                    const r = parseFloat(newLoan.interest_rate) || 0;
                                    const d = parseInt(newLoan.duration_periods, 10);
                                    const numMonths = d / 31;
                                    const nominalDays = d - numMonths;
                                    const totalInterest = p * (r / 100) * numMonths;
                                    const dailyInstallment = (p + totalInterest) / nominalDays;
                                    const trueTotal = dailyInstallment * d;
                                    return (
                                      <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '12px 14px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Flat Daily Installment (principal + interest):</span><strong style={{ color: 'var(--accent-blue)' }}>LKR {dailyInstallment.toLocaleString(undefined, { maximumFractionDigits: 2 })}/day</strong></div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Collected for:</span><strong>{d} days ({nominalDays} nominal + {numMonths} extra day{numMonths > 1 ? 's' : ''})</strong></div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-light)', paddingTop: '4px', marginTop: '2px' }}><span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>Total Repayable:</span><strong style={{ color: 'var(--accent-emerald)' }}>LKR {trueTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
                                      </div>
                                    );
                                  })()
                                : (newLoan.principal_amount > 0 && newLoan.interest_rate > 0 && (
                                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0' }}>
                                    {(() => {
                                      const p = parseFloat(newLoan.principal_amount) || 0;
                                      const r = parseFloat(newLoan.interest_rate) || 0;
                                      const monthlyInt = p * (r / 100);
                                      const perPeriod = newLoan.interest_type === 'daily' ? monthlyInt / 30 : newLoan.interest_type === 'weekly' ? monthlyInt / 4 : monthlyInt;
                                      return `Monthly interest: LKR ${monthlyInt.toLocaleString(undefined, { maximumFractionDigits: 2 })} (at ${r}% monthly rate). Collection mode '${newLoan.interest_type}': borrower is charged LKR ${perPeriod.toLocaleString(undefined, { maximumFractionDigits: 2 })} per ${newLoan.interest_type === 'daily' ? 'day (30 days = 1 month of interest)' : newLoan.interest_type === 'weekly' ? 'week' : 'month'}.`;
                                    })()}
                                  </p>
                                ))}

                              {user.role === 'agent' ? (
                                <div style={{ padding: '12px 14px', background: 'var(--accent-blue-light)', borderRadius: 'var(--radius-md)', fontSize: '13px', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <ClipboardCheck className="icon" /> You'll be the collection agent for this loan once it's approved.
                                </div>
                              ) : (
                                <div>
                                  <label htmlFor="f-assign-collection-agent-5594" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Assign Collection Agent</label>
                                  <select id="f-assign-collection-agent-5594" className="glass-input" value={newLoan.assigned_agent_id} onChange={e => setNewLoan(prev => ({ ...prev, assigned_agent_id: e.target.value }))}>
                                    <option value="">-- No Agent (Self Collect) --</option>
                                    {agentsList.map(a => (
                                      <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>

                            {/* --- SECTION 4: GUARANTOR CHECKBOX --- */}
                            <div style={{ border: '1px solid var(--border-glass)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', background: 'rgba(255,255,255,0.01)' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px', margin: 0 }}>
                                <input type="checkbox" checked={includeGuarantor} onChange={e => {
                                  setIncludeGuarantor(e.target.checked);
                                  if (!e.target.checked && giveLoanStep === 4) {
                                    setGiveLoanStep(3);
                                  }
                                }} />
                                <ShieldCheck className="icon" /> ADD GUARANTOR DETAILS (OPTIONAL)
                              </label>
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '24px', marginTop: '-8px' }}>
                                Checking this will add a fourth step to fill in the guarantor personal, income and expense details.
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: '12px' }}>
                              <button type="button" className="glass-btn glass-btn-secondary" onClick={() => handleWizardBack(3)} style={{ flex: 1, padding: '16px' }}>Back</button>
                              <button type="button" className="glass-btn glass-btn-emerald" onClick={() => handleWizardNext(3)} style={{ flex: 2, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                {includeGuarantor ? <>Continue to Guarantor <ArrowRight className="icon" /></> : (user.role === 'agent' ? <><ClipboardCheck className="icon" /> Submit for Approval</> : 'Disburse Cash Loan')}
                              </button>
                            </div>
                          </div>
                        )}

                        {giveLoanStep === 4 && includeGuarantor && (
                          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {guarantorForms.map((g, i) => (
                              <div key={i} style={{ border: '1px solid var(--border-glass)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <p style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', margin: '0', fontSize: '15px' }}>
                                    <ShieldCheck className="icon" /> 4. GUARANTOR DETAILS {guarantorForms.length > 1 ? `(${i + 1} of ${guarantorForms.length})` : ''}
                                  </p>
                                  {guarantorForms.length > 1 && (
                                    <button type="button" className="glass-btn glass-btn-rose" style={{ padding: '5px 10px', fontSize: '12px' }} onClick={() => handleRemoveGuarantorForm(i)}>
                                      <Trash2 className="icon" style={{ width: '14px', height: '14px' }} /> Remove
                                    </button>
                                  )}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                  <div className="form-grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                    <div>
                                      <label htmlFor={`guarantor_${i}_full_name`} style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Full Name *</label>
                                      <input id={`guarantor_${i}_full_name`} type="text" className="glass-input" style={{ borderColor: validationErrors[`guarantor_${i}_full_name`] ? 'var(--accent-rose)' : '', borderWidth: validationErrors[`guarantor_${i}_full_name`] ? '2px' : '' }} value={g.full_name} onChange={e => { updateGuarantorField(i, 'full_name', e.target.value); clearFieldError(`guarantor_${i}_full_name`); }} />
                                      {validationErrors[`guarantor_${i}_full_name`] && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors[`guarantor_${i}_full_name`]}</span>}
                                    </div>
                                    <div>
                                      <label htmlFor={`guarantor_${i}_nic_number`} style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>NIC Number *</label>
                                      <input id={`guarantor_${i}_nic_number`} type="text" className="glass-input" style={{ borderColor: validationErrors[`guarantor_${i}_nic_number`] ? 'var(--accent-rose)' : '', borderWidth: validationErrors[`guarantor_${i}_nic_number`] ? '2px' : '' }} placeholder="e.g. 199012345678 or 123456789V" value={g.nic_number} onChange={e => { updateGuarantorField(i, 'nic_number', e.target.value); clearFieldError(`guarantor_${i}_nic_number`); }} onBlur={e => runNicLookup(`guarantor_${i}`, e.target.value)} />
                                      {validationErrors[`guarantor_${i}_nic_number`] && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors[`guarantor_${i}_nic_number`]}</span>}
                                      {nicLookup[`guarantor_${i}`]?.loading && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>Checking record…</span>}
                                      {renderNicLookupWarning(`guarantor_${i}`, { forGuarantee: true })}
                                    </div>
                                  </div>

                                  <div>
                                    <label htmlFor="f-nic-photo-g-nic-photos-length-0-0-g-nic--5662" id={`guarantor_${i}_nic_photo`} style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>NIC Photo (Optional) {(g.nic_photos?.length || 0) > 0 && `(${g.nic_photos.length}/${MAX_KYC_PHOTOS})`}</label>
                                    <input id="f-nic-photo-g-nic-photos-length-0-0-g-nic--5662" type="file" accept="image/*" multiple className="glass-input" style={{ borderColor: validationErrors[`guarantor_${i}_nic_photo`] ? 'var(--accent-rose)' : '', borderWidth: validationErrors[`guarantor_${i}_nic_photo`] ? '2px' : '' }} onChange={e => { handleGuarantorPhotoChange(i, e); clearFieldError(`guarantor_${i}_nic_photo`); }} disabled={(g.nic_photos?.length || 0) >= MAX_KYC_PHOTOS} />
                                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Up to {MAX_KYC_PHOTOS} photos.</p>
                                    {(g.nic_photos?.length || 0) > 0 && (
                                      <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        {g.nic_photos.map((photo, idx) => (
                                          <div key={idx} style={{ position: 'relative' }}>
                                            <img src={photo} alt={`Guarantor NIC preview ${idx + 1}`} style={{ width: '52px', height: '38px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-glass)' }} />
                                            <button type="button" onClick={() => removeGuarantorNICPhoto(i, idx)} title="Remove" style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: '50%', background: 'var(--accent-rose)', color: '#fff', border: 'none', fontSize: '11px', lineHeight: 1, cursor: 'pointer' }}>×</button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {validationErrors[`guarantor_${i}_nic_photo`] && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors[`guarantor_${i}_nic_photo`]}</span>}
                                  </div>

                                  {/* No Photo Proof field for guarantors — NIC Photo above is enough
                                      to identify them; see the comment on runGuarantorValidation. */}

                                  <div>
                                    <label htmlFor={`guarantor_${i}_phone`} style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Phone Number *</label>
                                    <input id={`guarantor_${i}_phone`} type="tel" className="glass-input" style={{ borderColor: validationErrors[`guarantor_${i}_phone`] ? 'var(--accent-rose)' : '', borderWidth: validationErrors[`guarantor_${i}_phone`] ? '2px' : '' }} value={g.phone} onChange={e => { updateGuarantorField(i, 'phone', e.target.value); clearFieldError(`guarantor_${i}_phone`); }} />
                                    {validationErrors[`guarantor_${i}_phone`] && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors[`guarantor_${i}_phone`]}</span>}
                                  </div>

                                  <div>
                                    <label htmlFor={`guarantor_${i}_address`} style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Address (Optional)</label>
                                    <input id={`guarantor_${i}_address`} type="text" className="glass-input" style={{ borderColor: validationErrors[`guarantor_${i}_address`] ? 'var(--accent-rose)' : '', borderWidth: validationErrors[`guarantor_${i}_address`] ? '2px' : '' }} value={g.address} onChange={e => { updateGuarantorField(i, 'address', e.target.value); clearFieldError(`guarantor_${i}_address`); }} />
                                    {validationErrors[`guarantor_${i}_address`] && <span style={{ color: 'var(--accent-rose)', fontSize: '12px', marginTop: '4px', display: 'block', fontWeight: '500' }}>{validationErrors[`guarantor_${i}_address`]}</span>}
                                  </div>

                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                                      <input type="checkbox" checked={g.protected_under_debt_act} onChange={e => updateGuarantorField(i, 'protected_under_debt_act', e.target.checked)} />
                                      Protected under the state debt recovery act or any other law?
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                                      <input type="checkbox" checked={g.has_pending_court_cases} onChange={e => updateGuarantorField(i, 'has_pending_court_cases', e.target.checked)} />
                                      Any court judgments/cases registered against them?
                                    </label>
                                  </div>

                                  <div>
                                    <p style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' }}>Monthly Income (LKR)</p>
                                    <div className="form-grid-3-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                      <input type="number" min="0" className="glass-input" placeholder="Business" value={g.monthly_income_business} onChange={e => updateGuarantorField(i, 'monthly_income_business', e.target.value)} />
                                      <input type="number" min="0" className="glass-input" placeholder="Agriculture" value={g.monthly_income_agriculture} onChange={e => updateGuarantorField(i, 'monthly_income_agriculture', e.target.value)} />
                                      <input type="number" min="0" className="glass-input" placeholder="Other" value={g.monthly_income_other} onChange={e => updateGuarantorField(i, 'monthly_income_other', e.target.value)} />
                                    </div>
                                  </div>

                                  <div>
                                    <p style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '6px' }}>Monthly Expense (LKR)</p>
                                    <div className="form-grid-3-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                      <input type="number" min="0" className="glass-input" placeholder="Food" value={g.monthly_expense_food} onChange={e => updateGuarantorField(i, 'monthly_expense_food', e.target.value)} />
                                      <input type="number" min="0" className="glass-input" placeholder="House Rent" value={g.monthly_expense_rent} onChange={e => updateGuarantorField(i, 'monthly_expense_rent', e.target.value)} />
                                      <input type="number" min="0" className="glass-input" placeholder="Other" value={g.monthly_expense_other} onChange={e => updateGuarantorField(i, 'monthly_expense_other', e.target.value)} />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}

                            {guarantorForms.length < MAX_GUARANTORS_PER_LOAN && (
                              <button type="button" className="glass-btn glass-btn-secondary" onClick={handleAddGuarantorForm} style={{ padding: '10px 16px', fontSize: '13px', alignSelf: 'flex-start' }}>
                                <ShieldCheck className="icon" /> + Add Another Guarantor
                              </button>
                            )}

                            <div style={{ display: 'flex', gap: '12px' }}>
                              <button type="button" className="glass-btn glass-btn-secondary" onClick={() => handleWizardBack(4)} style={{ flex: 1, padding: '16px' }}>Back</button>
                              <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ flex: 2, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                {user.role === 'agent' ? <><ClipboardCheck className="icon" /> Submit for Approval</> : 'Disburse Cash Loan'}
                              </button>
                            </div>
                          </div>
                        )}
                      </form>
                    </div>
                  </div>
                </div>
              </div>
            )}

        {/* ----------------- AGENT DASHBOARD ----------------- */}
        {token && user && user.role === 'agent' && view === 'dashboard' && agentData && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Sticky / Quick Shift Summary Pill for Agent */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'linear-gradient(135deg, rgba(4, 120, 87, 0.1) 0%, rgba(37, 84, 232, 0.06) 100%)',
              border: '1px solid var(--accent-emerald)', borderRadius: '12px', padding: '10px 14px',
              gap: '10px', flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent-emerald)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Banknote style={{ width: '20px', height: '20px' }} />
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Cash In Hand (Today)</div>
                  <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--accent-emerald)' }}>
                    LKR {(agentData.summary.collectionsToday || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div role="group" aria-label="Payment entry mode" style={{ display: 'flex', gap: '4px', background: 'var(--bg-tertiary)', padding: '3px', borderRadius: '10px', border: '1px solid var(--border-light)' }}>
                  <button
                    type="button"
                    aria-pressed={agentSubView === 'record-payment'}
                    className={`glass-btn ${agentSubView === 'record-payment' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
                    style={{ padding: '8px 12px', fontSize: '13px', minHeight: '44px', borderRadius: '8px', border: 'none' }}
                    onClick={() => setAgentSubView('record-payment')}
                  >
                    <Calendar className="icon" /> Route sheet
                  </button>
                  <button
                    type="button"
                    aria-pressed={agentSubView === 'collect'}
                    className={`glass-btn ${agentSubView === 'collect' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
                    style={{ padding: '8px 12px', fontSize: '13px', minHeight: '44px', borderRadius: '8px', border: 'none' }}
                    onClick={() => setAgentSubView('collect')}
                  >
                    <CreditCard className="icon" /> Single payment
                  </button>
                </div>
                <button
                  type="button"
                  className="glass-btn glass-btn-emerald"
                  style={{ padding: '8px 14px', fontSize: '13px', minHeight: '44px', borderRadius: '8px' }}
                  onClick={() => setAgentSubView('remit')}
                >
                  <Landmark className="icon" /> Remit
                </button>
              </div>
            </div>

            {agentSubView === 'next-day-tasklist' && (
              <NextDayTasklistTab loans={agentData.assignedLoans} onNavigateRecordPayment={() => setAgentSubView('record-payment')} />
            )}
            
            {agentSubView === 'record-payment' && (
              <RecordDailyPaymentsTab loans={agentData.assignedLoans} onRefresh={fetchDashboardData} showToast={showToast} />
            )}
            
            {agentSubView === 'collect' && (
              <>
                {/* KPI metrics */}
                <div className="responsive-grid-equal-2-col">
                  <div className="kpi-card kpi-card-emerald">
                    <span className="kpi-lbl">Collected Today</span>
                    <h3 className="kpi-val" style={{ color: 'var(--accent-emerald)' }}>LKR {agentData.summary.collectionsToday.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Total cash collected today</span>
                  </div>
                  <div className="kpi-card kpi-card-blue">
                    <span className="kpi-lbl">My Customers</span>
                    <h3 className="kpi-val">{agentData.summary.assignedCount} Active</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Customers on your route</span>
                  </div>
                </div>

                {/* Mobile-only switcher: below 768px the two panels below stack
                    into one long scroll, so let the agent jump straight to
                    whichever one they need instead of scrolling past both
                    every time. No effect on desktop, which keeps showing
                    both panels side by side. */}
                <div className="mobile-only" style={{ display: 'flex', gap: '8px', background: 'var(--bg-tertiary)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-light)' }}>
                  <button type="button"
                    className={`glass-btn ${agentCollectMobileTab === 'form' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
                    style={{ flex: 1, padding: '8px', fontSize: '13px', border: 'none' }}
                    onClick={() => setAgentCollectMobileTab('form')}>
                    <Banknote className="icon" /> Enter Payment
                  </button>
                  <button type="button"
                    className={`glass-btn ${agentCollectMobileTab === 'customers' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
                    style={{ flex: 1, padding: '8px', fontSize: '13px', border: 'none' }}
                    onClick={() => setAgentCollectMobileTab('customers')}>
                    <ClipboardCheck className="icon" /> My Customers
                  </button>
                </div>

                {/* Quick entry for agent collection */}
                <div className="responsive-grid-2-col">

                  {/* Collection Submission Form */}
                  <div className={`glass-card agent-collect-panel ${agentCollectMobileTab === 'form' ? 'active' : ''}`}>
                    <h3 style={{ fontSize: '26px', marginBottom: '8px' }}><Banknote className="icon" /> Single Payment</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>Select a customer and enter the cash collected from them.</p>
                    
                    <form onSubmit={handleCollectPayment} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      
                      <div>
                        <label htmlFor="f-choose-customer-5805" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Choose Customer</label>
                        <input
                          type="search"
                          className="glass-input"
                          aria-label="Search customers by name or phone"
                          placeholder="Type a name or phone to find a customer…"
                          value={agentCustomerSearch}
                          onChange={e => setAgentCustomerSearch(e.target.value)}
                          style={{ marginBottom: '8px' }}
                        />
                        <select id="f-choose-customer-5805" required className="glass-input" value={paymentForm.loan_id} onChange={e => resetPaymentForm(e.target.value)}>
                          <option value="">-- Select Customer --</option>
                          {agentData.assignedLoans.filter(l => {
                            if (l.status !== 'active') return false;
                            const q = agentCustomerSearch.trim().toLowerCase();
                            if (!q || l.id === paymentForm.loan_id) return true;
                            return (l.borrower_name || '').toLowerCase().includes(q) || (l.borrower_phone || '').includes(q);
                          }).map(loan => (
                            <option key={loan.id} value={loan.id}>
                              {loan.interest_type === 'daily'
                                ? `${loan.borrower_name} (Total Outstanding: LKR ${(parseFloat(loan.principal_outstanding || 0) + parseFloat(loan.interest_balance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                                : `${loan.borrower_name} (Principal: LKR ${parseFloat(loan.principal_outstanding).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, Interest Due: LKR ${parseFloat(loan.interest_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label id="f-agent-payment-type" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Payment Type</label>
                        <div role="group" aria-labelledby="f-agent-payment-type" style={{ display: 'flex', gap: '10px' }}>
                          <button type="button"
                            className={`glass-btn ${paymentForm.payment_type === 'interest' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
                            style={{ flex: 1 }}
                            onClick={() => setPaymentForm(prev => ({ ...prev, payment_type: 'interest', amount: '' }))}>
                            Pay Interest
                          </button>
                          <button type="button"
                            className={`glass-btn ${paymentForm.payment_type === 'principal' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
                            style={{ flex: 1 }}
                            onClick={() => setPaymentForm(prev => ({ ...prev, payment_type: 'principal', amount: '' }))}>
                            Pay Principal
                          </button>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="f-agent-payment-amount" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>
                          {paymentForm.payment_type === 'interest' ? 'Interest Amount (LKR)' : 'Principal Amount (LKR)'}
                        </label>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                          <input id="f-agent-payment-amount" type="number" required min="1" className="glass-input" placeholder="Enter amount" value={paymentForm.amount} onChange={e => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))} />
                        </div>
                        {/* Quick-fill: exact amount currently due for the selected payment type */}
                        {paymentForm.loan_id && (() => {
                          const loan = agentData.assignedLoans.find(l => l.id === paymentForm.loan_id);
                          if (!loan) return null;
                          const interestDue = parseFloat(loan.interest_balance) || 0;
                          const principalOutstanding = parseFloat(loan.principal_outstanding) || 0;
                          const calcPeriodDue = () => {
                            if (loan.is_flat_installment) return flatInstallmentDueToday(loan);
                            const monthlyInterest = (parseFloat(loan.principal_amount) || 0) * ((parseFloat(loan.interest_rate) || 0) / 100);
                            if (loan.interest_type === 'daily') return Math.round(monthlyInterest / 30);
                            if (loan.interest_type === 'weekly') return Math.round(monthlyInterest / 4);
                            return Math.round(monthlyInterest);
                          };
                          const pDue = calcPeriodDue();
                          return (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                              {pDue > 0 && (
                                <button type="button" className="quick-amt-chip emerald" onClick={() => setPaymentForm(prev => ({ ...prev, amount: pDue.toString(), payment_type: loan.is_flat_installment ? 'principal' : 'interest' }))}>
                                  ⚡ Cycle Due (LKR {pDue.toLocaleString()})
                                </button>
                              )}
                              {interestDue > 0 && (
                                <button type="button" className="quick-amt-chip" onClick={() => setPaymentForm(prev => ({ ...prev, amount: interestDue.toString(), payment_type: 'interest' }))}>
                                  Interest Due (LKR {interestDue.toLocaleString()})
                                </button>
                              )}
                              {principalOutstanding > 0 && (
                                <button type="button" className="quick-amt-chip" onClick={() => setPaymentForm(prev => ({ ...prev, amount: principalOutstanding.toString(), payment_type: 'principal' }))}>
                                  Full Principal (LKR {principalOutstanding.toLocaleString()})
                                </button>
                              )}
                            </div>
                          );
                        })()}
                        {/* Quick increment buttons */}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {[500, 1000, 2000, 5000].map(val => (
                            <button key={val} type="button" className="quick-amt-chip" onClick={() => setPaymentForm(prev => ({ ...prev, amount: val.toString() }))}>
                              LKR {val.toLocaleString()}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label htmlFor="f-payment-method-5866" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Payment Method</label>
                        <select id="f-payment-method-5866" required className="glass-input" value={paymentForm.payment_method} onChange={e => setPaymentForm(prev => ({ ...prev, payment_method: e.target.value }))}>
                          <option value="cash">Cash Collection</option>
                          <option value="bank_transfer">Bank Deposit / Transfer</option>
                          <option value="mobile_wallet">Mobile Wallet (eZ Cash / mCash)</option>
                          <option value="card">Card Payment</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor="f-receipt-photo-optional-5876" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Receipt Photo (Optional — Camera / File)</label>
                        <input id="f-receipt-photo-optional-5876" type="file" accept="image/*" capture="environment" className="glass-input" onChange={handleFileChange} />
                        {paymentForm.proof_image && (
                          <div style={{ marginTop: '10px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--accent-emerald)' }}><CircleCheck className="icon" /> Photo attached.</span>
                          </div>
                        )}
                      </div>

                      <div>
                        <label htmlFor="f-notes-optional-5886" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>Notes (Optional)</label>
                        <textarea id="f-notes-optional-5886" className="glass-input" rows="2" placeholder="e.g. Paid in full, promised next Friday" value={paymentForm.notes} onChange={e => setPaymentForm(prev => ({ ...prev, notes: e.target.value }))} />
                      </div>

                      {/* Anti-double submission unique lock */}
                      <div style={{ padding: '10px', background: '#f1f5f9', border: '1px dashed #cbd5e1', borderRadius: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Security Code: <strong>{paymentForm.idempotency_key}</strong>
                      </div>

                      <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ width: '100%' }}>
                        {loading ? 'Saving...' : 'Save Payment'}
                      </button>
                    </form>
                  </div>

                  {/* My Customers — Pending / Active / Defaulted / Closed / Rejected */}
                  <div className={`glass-card agent-collect-panel ${agentCollectMobileTab === 'customers' ? 'active' : ''}`}>
                    <h3 style={{ fontSize: '24px', marginBottom: '12px' }}><ClipboardCheck className="icon" /> My Customers</h3>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                      {['pending', 'active', 'defaulted', 'closed', 'rejected'].map(tab => {
                        const count = agentData.assignedLoans.filter(l => tab === 'closed' ? ['fully_paid', 'written_off'].includes(l.status) : l.status === tab).length;
                        return (
                          <button key={tab} type="button"
                            className={`glass-btn ${agentCustomerTab === tab ? (tab === 'pending' ? 'glass-btn-amber' : tab === 'rejected' ? 'glass-btn-secondary' : 'glass-btn-emerald') : 'glass-btn-secondary'}`}
                            style={{ padding: '6px 14px', fontSize: '12px', textTransform: 'capitalize' }}
                            onClick={() => setAgentCustomerTab(tab)}>
                            {tab === 'pending' ? 'Pending Approval' : tab} ({count})
                          </button>
                        );
                      })}
                    </div>
                    {(() => {
                      const tabLoans = agentData.assignedLoans.filter(l => agentCustomerTab === 'closed' ? ['fully_paid', 'written_off'].includes(l.status) : l.status === agentCustomerTab);
                      if (tabLoans.length === 0) {
                        return <p style={{ color: 'var(--text-muted)' }}>No {agentCustomerTab} customers.</p>;
                      }
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {tabLoans.map(loan => {
                            const status = loan.today_collection_status;
                            const statusBadge = status === 'paid'
                              ? <span className="badge badge-active">Paid Today</span>
                              : status === 'partial'
                                ? <span className="badge badge-pending">Partial</span>
                                : status === 'not_paid'
                                  ? <span className="badge badge-defaulted">Missed</span>
                                  : <span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>Not Marked</span>;
                            const cleanPhone = (loan.borrower_phone || '').replace(/[^0-9+]/g, '');
                            const waDigits = cleanPhone.replace(/[^0-9]/g, '');
                            const waNumber = waDigits.startsWith('0') ? '94' + waDigits.slice(1) : waDigits;

                            return (
                              <div key={loan.id} style={{ padding: '16px', background: 'var(--bg-primary)', border: '1px solid var(--border-light)', borderRadius: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                                  <div>
                                    <strong style={{ display: 'block', fontSize: '15px' }}>{loan.borrower_name}</strong>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><Phone className="icon" style={{ width: '12px', height: '12px' }} /> {loan.borrower_phone || 'No phone'}</span>
                                      {cleanPhone && (
                                        <span className="quick-contact-actions" onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: '4px' }}>
                                          <a href={`tel:${cleanPhone}`} className="quick-contact-btn phone" title="Direct Dial" style={{ color: 'var(--accent-blue)' }}>
                                            <Phone style={{ width: '11px', height: '11px' }} />
                                          </a>
                                          <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noopener noreferrer" className="quick-contact-btn whatsapp" title="Chat on WhatsApp" style={{ color: '#25D366' }}>
                                            <MessageSquare style={{ width: '11px', height: '11px' }} />
                                          </a>
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                      Type: <span style={{ textTransform: 'capitalize' }}>{loan.interest_type} ({loan.interest_rate}%)</span>
                                      {loan.status !== 'active' && <span> • Status: <span style={{ textTransform: 'capitalize' }}>{loan.status.replace('_', ' ')}</span></span>}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <span style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-rose)' }}>
                                      Principal: LKR {parseFloat(loan.principal_outstanding).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-rose)' }}>
                                      Interest: LKR {parseFloat(loan.interest_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                </div>
                                {loan.status === 'active' && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-light)' }}>
                                    {statusBadge}
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                      {cleanPhone && (
                                        <a
                                          href={`tel:${cleanPhone}`}
                                          className="glass-btn"
                                          style={{
                                            padding: '6px 12px',
                                            fontSize: '12px',
                                            borderRadius: '4px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            textDecoration: 'none',
                                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                            color: '#ffffff',
                                            fontWeight: '600'
                                          }}
                                          title={`Direct dial ${loan.borrower_phone}`}
                                        >
                                          <Phone style={{ width: '12px', height: '12px' }} /> Call
                                        </a>
                                      )}
                                      <button className="glass-btn glass-btn-emerald" style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '4px' }} onClick={() => handleMarkDailyCollection(loan.id, 'paid')} disabled={loading}>
                                        <Check className="icon" /> Paid
                                      </button>
                                      <button className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '4px' }} onClick={() => handleMarkDailyCollection(loan.id, 'partial')} disabled={loading}>
                                        Partial
                                      </button>
                                      <button className="glass-btn glass-btn-rose" style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '4px' }} onClick={() => handleMarkDailyCollection(loan.id, 'not_paid')} disabled={loading}>
                                        <X className="icon" /> Missed
                                      </button>
                                      <button className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '4px' }} onClick={() => { resetPaymentForm(loan.id); setAgentCollectMobileTab('form'); }}>
                                        Full Form
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                </div>
              </>
            )}

            {agentSubView === 'history' && (
              /* Agent Collection log */
              <div className="glass-card">
                <h3 style={{ fontSize: '24px', marginBottom: '16px' }}><ScrollText className="icon" /> Saved Collections Today</h3>
                {agentData.collectionHistory.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No payments saved today.</p>
                ) : (
                  <>
                    {/* Desktop View Table */}
                    <div className="desktop-only" style={{ overflowX: 'auto' }}>
                      <table className="glass-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Borrower</th>
                            <th>Amount Collected</th>
                            <th>Security Code</th>
                            <th>Notes</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agentData.collectionHistory.map(tx => (
                            <tr key={tx.id}>
                              <td>{new Date(tx.payment_date).toLocaleString()}</td>
                              <td>{tx.borrower_name}</td>
                              <td style={{ color: 'var(--accent-emerald)', fontWeight: 'bold' }}>LKR {parseFloat(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{tx.idempotency_key}</td>
                              <td>{tx.notes || '-'}</td>
                              <td>
                                <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '4px' }} onClick={() => {
                                  const loan = agentData.assignedLoans.find(l => l.id === tx.loan_id);
                                  handleOpenReceipt(tx, {
                                    borrowerPhone: loan?.borrower_phone,
                                    loanPrincipal: loan?.principal_amount,
                                    loanInterestRate: loan?.interest_rate,
                                    loanInterestType: loan?.interest_type,
                                    loanPrincipalOutstanding: loan?.principal_outstanding,
                                    loanInterestBalance: loan?.interest_balance
                                  });
                                }}>
                                  <FileText className="icon" /> Receipt
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile View Cards */}
                    <div className="mobile-only mobile-card-list">
                      {agentData.collectionHistory.map(tx => (
                        <div key={tx.id} className="mobile-row-card mobile-row-card-success">
                          <div className="mobile-row-card-header">
                            <span className="mobile-row-card-title">{tx.borrower_name}</span>
                            <span className="badge badge-active" style={{ color: 'var(--accent-emerald)' }}>LKR {parseFloat(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="mobile-row-card-grid">
                            <span className="mobile-row-card-label">Date</span>
                            <span className="mobile-row-card-value">{new Date(tx.payment_date).toLocaleDateString()}</span>
                            
                            <span className="mobile-row-card-label">Security Code</span>
                            <span className="mobile-row-card-value" style={{ fontSize: '12px', fontFamily: 'monospace', wordBreak: 'break-all' }}>{tx.idempotency_key}</span>
                          </div>
                          {tx.notes && (
                            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '8px', marginTop: '4px', fontSize: '14px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                              Notes: "{tx.notes}"
                            </div>
                          )}
                          <div className="mobile-row-card-actions">
                            <button type="button" className="glass-btn glass-btn-secondary" onClick={() => {
                              const loan = agentData.assignedLoans.find(l => l.id === tx.loan_id);
                              handleOpenReceipt(tx, {
                                borrowerPhone: loan?.borrower_phone,
                                loanPrincipal: loan?.principal_amount,
                                loanInterestRate: loan?.interest_rate,
                                loanInterestType: loan?.interest_type,
                                loanPrincipalOutstanding: loan?.principal_outstanding,
                                loanInterestBalance: loan?.interest_balance
                              });
                            }}>
                              <FileText className="icon" /> Print Receipt
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {agentSubView === 'remit' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div className="responsive-grid-equal-2-col">
                  <div className="kpi-card kpi-card-emerald">
                    <span className="kpi-lbl">Collected (All Time)</span>
                    <h3 className="kpi-val" style={{ color: 'var(--accent-emerald)' }}>LKR {(agentData.summary.totalCollected || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                  </div>
                  <div className="kpi-card kpi-card-rose">
                    <span className="kpi-lbl">Cash Still In Hand</span>
                    <h3 className="kpi-val" style={{ color: 'var(--accent-rose)' }}>LKR {(agentData.summary.cashInHand || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Collected minus what you've remitted to the office</span>
                  </div>
                </div>

                <div className="glass-card">
                  <h3 style={{ fontSize: '22px', marginBottom: '16px' }}><Landmark className="icon" /> Hand over Cash to Office</h3>
                  <form onSubmit={handleSubmitRemittance} style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '420px' }}>
                    <div>
                      <label htmlFor="f-amount-lkr-6095" style={{ fontSize: '13px', fontWeight: 'bold' }}>Amount (LKR)</label>
                      <input id="f-amount-lkr-6095" type="number" min="1" required className="glass-input" placeholder="e.g. 20000"
                        value={remittanceForm.amount}
                        onChange={e => setRemittanceForm(prev => ({ ...prev, amount: e.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor="f-notes-6101" style={{ fontSize: '13px', fontWeight: 'bold' }}>Notes</label>
                      <input id="f-notes-6101" type="text" className="glass-input" placeholder="e.g. Handed to admin at branch office"
                        value={remittanceForm.notes}
                        onChange={e => setRemittanceForm(prev => ({ ...prev, notes: e.target.value }))} />
                    </div>
                    <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ width: '100%' }}>Submit Handover</button>
                  </form>
                </div>

                <div className="glass-card">
                  <h3 style={{ fontSize: '22px', marginBottom: '16px' }}><ScrollText className="icon" /> My Handover History</h3>
                  {remittances.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No cash handovers submitted yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {remittances.map(r => (
                        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
                          <div>
                            <div style={{ fontWeight: 'bold' }}>LKR {parseFloat(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{new Date(r.created_at).toLocaleString()} {r.notes ? `• ${r.notes}` : ''}</div>
                          </div>
                          <span className={`badge ${r.status === 'verified' ? 'badge-active' : 'badge-defaulted'}`}>{r.status === 'verified' ? 'Verified' : 'Pending'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ----------------- DOUBLE-ENTRY STATEMENT AUDIT LEDGER ----------------- */}
        {token && user && view === 'ledger' && (
          !loanStatement ? (
            <div className="glass-card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '16px' }}>
              <div className="loading-spinner" />
              <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Loading loan file details...</p>
            </div>
          ) : (() => {
          // Construct passbook events chronologically. Interest-only model —
          // principal and interest are two separate running balances:
          // disbursement/principal-payments only move the principal balance,
          // accruals/penalties/interest-payments only move the interest balance.
          //
          // Flat-installment loans never generate interest_accrual rows going
          // forward (the daily accrual cron skips them — the flat daily
          // amount already bundles principal+interest). Any accrual rows on
          // a loan that's flat-installment now are leftovers from before it
          // was converted from the old interest-only model, and would only
          // show up here as confusing stale "Interest Added" entries under a
          // schedule the loan no longer follows — so they're excluded from
          // this loan's activity log entirely.
          const relevantAccruals = loanStatement.loan.is_flat_installment ? [] : loanStatement.accruals;
          // Every event carries an explicit principalDelta/interestDelta
          // pair rather than one bucket + a signed amount — needed because
          // a flat-installment payment moves BOTH balances in the same
          // cash collection (it bundles principal+interest into one daily
          // amount), which a single bucket can't represent. Splitting by
          // p.principal_component/interest_component here mirrors exactly
          // what the ledger itself posted for that transaction (see
          // recordFlatInstallmentCollection in src/lib/services/ledger.js)
          // — previously the whole payment fell into the 'interest' bucket
          // only, leaving Principal Bal frozen at the original amount and
          // Interest Bal drifting deeply negative with every collection.
          //
          // Flat-installment loans also need their interest bucket SEEDED
          // at disbursement, same as the principal bucket — non-flat loans
          // build their interest balance up gradually through "Interest
          // Added" accrual events over time, but flat loans have none of
          // those (the whole term's interest is fixed up front, bundled
          // into the daily rate), so without this the interest bucket
          // would start at 0 and every payment would just push it further
          // negative. daily_installment_amount × duration − principal is
          // exactly how the loan's interest_balance was set at creation.
          const flatTotalInterest = loanStatement.loan.is_flat_installment
            ? (parseFloat(loanStatement.loan.daily_installment_amount) || 0) * (parseFloat(loanStatement.loan.duration_periods) || 0) - (parseFloat(loanStatement.loan.principal_amount) || 0)
            : 0;
          const events = [
            {
              date: loanStatement.loan.created_at,
              type: 'Loan Disbursed',
              amount: parseFloat(loanStatement.loan.principal_amount),
              principalDelta: parseFloat(loanStatement.loan.principal_amount),
              interestDelta: flatTotalInterest,
              details: loanStatement.loan.is_flat_installment
                ? `Initial principal loan amount (plus LKR ${flatTotalInterest.toLocaleString(undefined, { minimumFractionDigits: 2 })} total interest for the full term, fixed at disbursement)`
                : 'Initial principal loan amount'
            },
            ...relevantAccruals.map(acc => ({
              date: acc.created_at,
              type: 'Interest Added',
              amount: parseFloat(acc.amount_accrued),
              principalDelta: 0,
              interestDelta: parseFloat(acc.amount_accrued),
              details: `Interest charged (${acc.calculation_log.split('|')[1]?.trim() || ''})`
            })),
            ...loanStatement.payments.map(p => {
              const amt = parseFloat(p.amount);
              let principalDelta = 0, interestDelta = 0, type;
              if (p.payment_type === 'flat_installment') {
                principalDelta = -(parseFloat(p.principal_component) || 0);
                interestDelta = -(parseFloat(p.interest_component) || 0);
                type = 'Installment Payment';
              } else if (p.payment_type === 'principal') {
                principalDelta = -amt;
                type = 'Principal Payment';
              } else {
                interestDelta = -amt;
                type = 'Interest Payment';
              }
              return {
                date: p.payment_date,
                type,
                amount: amt,
                principalDelta,
                interestDelta,
                details: `Cash collected by ${p.agent_name} ${p.notes ? ` - "${p.notes}"` : ''}`
              };
            }),
            ...loanStatement.ledger.filter(l => l.account === 'penalty_revenue').map(l => ({
              date: l.created_at,
              type: 'Penalty Applied',
              amount: parseFloat(l.amount),
              principalDelta: 0,
              interestDelta: parseFloat(l.amount),
              details: 'Manual late fee / penalty charged by admin'
            }))
          ];

          // Sort chronologically (oldest first)
          events.sort((a, b) => new Date(a.date) - new Date(b.date));

          // Compute the two running balances in parallel. 'change' (used
          // just for the increase/decrease badge color and +/- sign) is
          // derived from the net direction of both deltas together — for
          // every event type except flat-installment payments this is the
          // same single-bucket direction as before; for flat-installment
          // payments both deltas point the same way (a collection), so the
          // net is unambiguous too.
          let principalBal = 0;
          let interestBal = 0;
          const eventsWithBalance = events.map(ev => {
            principalBal += ev.principalDelta;
            interestBal += ev.interestDelta;
            return {
              ...ev,
              change: (ev.principalDelta + ev.interestDelta) >= 0 ? 'increase' : 'decrease',
              runningPrincipalBalance: principalBal,
              runningInterestBalance: interestBal
            };
          });

          // Reverse chronological for list rendering (newest first)
          const displayEvents = [...eventsWithBalance].reverse();

          return (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

              {/* Pending approval banner — the whole point of this loan
                  file view (all the tabs below: Passbook, Borrower Profile,
                  Guarantor Info) is that admin can review every detail an
                  agent submitted before deciding, so the approve/reject
                  actions live right here at the top rather than buried in a
                  separate review screen. */}
              {loanStatement.loan.status === 'pending' && (
                <div className="glass-card" style={{ border: '2px solid var(--accent-amber, #d97706)', background: 'var(--accent-blue-light)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Clock className="icon" style={{ width: '28px', height: '28px', color: '#b45309' }} />
                      <div>
                        <h3 style={{ fontSize: '18px', margin: 0 }}>Pending Approval</h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                          {loanStatement.loan.agent_name ? `Submitted by ${loanStatement.loan.agent_name}. ` : ''}
                          No cash has been disbursed yet — review the details below before deciding.
                        </p>
                      </div>
                    </div>
                    {user.role === 'admin' && (
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="glass-btn glass-btn-emerald" onClick={handleApproveLoan} disabled={loading}>
                          <ThumbsUp className="icon" /> Approve
                        </button>
                        <button className="glass-btn glass-btn-rose" onClick={handleRejectLoan} disabled={loading}>
                          <ThumbsDown className="icon" /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {loanStatement.loan.status === 'rejected' && (
                <div className="glass-card" style={{ border: '2px solid var(--accent-rose)', background: 'rgba(239, 68, 68, 0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Ban className="icon" style={{ width: '28px', height: '28px', color: 'var(--accent-rose)' }} />
                    <div>
                      <h3 style={{ fontSize: '18px', margin: 0 }}>Application Rejected</h3>
                      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                        Reason: {loanStatement.loan.loan_rejection_reason || 'No reason recorded.'}
                        {loanStatement.loan.rejected_at && ` — ${new Date(loanStatement.loan.rejected_at).toLocaleString()}`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Header info card */}
              <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
                <div style={{ flex: '1 1 300px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--accent-blue)', fontWeight: 'bold', letterSpacing: '0.05em' }}>LOAN STATEMENT & HISTORY</span>
                  <h2 style={{ fontSize: '28px', margin: '4px 0', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    Loan Details: {loanStatement.loan.borrower_name}
                    {loanStatement.loan.reference_number && (
                      <span style={{ fontSize: '16px', color: 'var(--accent-blue)', background: 'rgba(59, 130, 246, 0.1)', padding: '4px 10px', borderRadius: '6px', fontWeight: 'bold' }}>
                        {loanStatement.loan.reference_number}
                      </span>
                    )}
                  </h2>
                  
                  {/* Styled responsive metrics grid. Flat-installment (daily
                      principal+interest bundled) loans show one combined
                      "Total Outstanding" instead of splitting Principal
                      Outstanding / Interest Due into two figures — that
                      split is internal bookkeeping (it's what drives the
                      two separate ledger accounts), not something a daily
                      collection borrower/agent needs to reason about;
                      showing it prominently here was just confusing. Every
                      other loan type is unchanged. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px 16px', margin: '12px 0' }}>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                      Original Principal: <strong style={{ color: 'var(--text-primary)' }}>LKR {parseFloat(loanStatement.loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    </div>
                    {showsUnifiedOutstanding(loanStatement.loan) ? (
                      <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                        Total Outstanding: <strong style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}>
                          LKR {(parseFloat(loanStatement.loan.principal_outstanding || 0) + parseFloat(loanStatement.loan.interest_balance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </strong>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                          Principal Outstanding: <strong style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}>LKR {parseFloat(loanStatement.loan.principal_outstanding).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                        </div>
                        <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                          Interest Due: <strong style={{ color: 'var(--accent-rose)', fontWeight: 'bold' }}>LKR {parseFloat(loanStatement.loan.interest_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                          {(() => {
                            const projected = projectCurrentInterestBalance(loanStatement.loan);
                            const stored = parseFloat(loanStatement.loan.interest_balance) || 0;
                            if (Math.abs(projected - stored) < 0.01) return null;
                            return (
                              <span style={{ color: 'var(--text-muted)', fontSize: '12px', display: 'block', marginTop: '2px' }}>
                                (Est. now: <strong style={{ color: 'var(--accent-rose)' }}>LKR {projected.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>)
                              </span>
                            );
                          })()}
                        </div>
                      </>
                    )}
                  </div>

                  <p style={{ color: 'var(--text-secondary)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 6px', flexWrap: 'wrap' }}>
                    <span><IdCard className="icon" /> NIC Number: <strong>{loanStatement.loan.nic_number || 'N/A'}</strong></span>
                    {(loanStatement.loan.nic_photo_urls?.length > 0 || loanStatement.loan.nic_photo_url) && (
                      <>
                        <span>•</span>
                        <a
                          href="#"
                          style={{ color: 'var(--accent-blue)', textDecoration: 'underline', fontWeight: '500', display: 'inline-block', padding: '10px 4px', margin: '-10px -4px' }}
                          onClick={(e) => {
                            e.preventDefault();
                            const photos = loanStatement.loan.nic_photo_urls?.length > 0 ? loanStatement.loan.nic_photo_urls : [loanStatement.loan.nic_photo_url];
                            const win = window.open();
                            win.document.write(photos.map((url, i) => `<img src="${url}" alt="NIC photo ${i + 1} of ${photos.length} for ${loanStatement.loan.borrower_name || 'this borrower'}" style="max-width:100%; height:auto; box-shadow: 0 4px 10px rgba(0,0,0,0.3); border-radius: 8px; display:block; margin-bottom: 16px;" />`).join(''));
                          }}
                        >
                          View NIC Photo{loanStatement.loan.nic_photo_urls?.length > 1 ? `s (${loanStatement.loan.nic_photo_urls.length})` : ''}
                        </a>
                      </>
                    )}
                  </p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 4px' }}>
                    Address: <strong>{loanStatement.loan.borrower_address || 'N/A'}</strong>
                    {loanStatement.loan.borrower_email && <> | Email: <strong>{loanStatement.loan.borrower_email}</strong></>}
                  </p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0' }}>
                    Loan Term: <strong style={{ textTransform: 'capitalize' }}>
                      {loanStatement.loan.collection_mode === 'fixed_term' ? 'Fixed Term' : 'Open-Ended'}
                    </strong>
                    {loanStatement.loan.collection_mode === 'fixed_term' && loanStatement.loan.maturity_date && (
                      <>
                        {' '}| Maturity: <strong>{new Date(loanStatement.loan.maturity_date).toLocaleDateString()}</strong>
                        {(() => {
                          const today = new Date();
                          today.setHours(0,0,0,0);
                          const maturity = new Date(loanStatement.loan.maturity_date);
                          const diffTime = maturity - today;
                          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                          if (diffDays < 0) {
                            return <span style={{ color: 'var(--accent-rose)', marginLeft: '8px', fontWeight: 'bold' }}>(OVERDUE by {Math.abs(diffDays)} day(s))</span>;
                          } else if (diffDays === 0) {
                            return <span style={{ color: 'var(--accent-rose)', marginLeft: '8px', fontWeight: 'bold' }}>(MATURES TODAY!)</span>;
                          } else {
                            return <span style={{ color: 'var(--accent-emerald)', marginLeft: '8px' }}>({diffDays} day(s) remaining)</span>;
                          }
                        })()}
                      </>
                    )}
                  </p>
                </div>
                
                {/* Actions group with flex layout — icon-only on mobile (see
                    .loan-detail-actions in globals.css), full label + icon
                    on desktop. */}
                <div className="loan-detail-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', width: '100%', maxWidth: '360px' }}>
                  <button className="glass-btn glass-btn-secondary" style={{ flex: 1, minWidth: '160px', padding: '10px 16px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} onClick={() => setShowLoanAgreement(true)} title="View Agreement">
                    <FileText className="icon" /> <span className="btn-label-text">View Agreement</span>
                  </button>
                  <button className="glass-btn" style={{ flex: 1, minWidth: '160px', padding: '10px 16px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} onClick={handleDownloadAgreement} disabled={downloadingAgreement} title={downloadingAgreement ? 'Generating...' : 'Download PDF'}>
                    <Download className="icon" /> <span className="btn-label-text">{downloadingAgreement ? 'Generating...' : 'Download PDF'}</span>
                  </button>
                  <button className="glass-btn glass-btn-emerald" style={{ flex: 1, minWidth: '160px', padding: '10px 16px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} onClick={() => { setView('dashboard'); setSelectedLoanId(null); setLoanStatement(null); }} title="Go Back">
                    <ArrowLeft className="icon" /> <span className="btn-label-text">Go Back</span>
                  </button>
                </div>
              </div>

              {/* Tab Navigation Menu */}
              <div className="loan-file-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border-light)', gap: '8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '0px' }}>
                <button
                  type="button"
                  className="loan-file-tab"
                  onClick={() => setLedgerTab('passbook')}
                  style={{
                    padding: '12px 16px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    background: 'none',
                    border: 'none',
                    borderBottom: ledgerTab === 'passbook' ? '3px solid var(--accent-blue)' : '3px solid transparent',
                    color: ledgerTab === 'passbook' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Receipt className="icon" style={{ fontSize: '16px' }} /> Passbook & Payments
                </button>
                <button
                  type="button"
                  className="loan-file-tab"
                  onClick={() => setLedgerTab('profile')}
                  style={{
                    padding: '12px 16px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    background: 'none',
                    border: 'none',
                    borderBottom: ledgerTab === 'profile' ? '3px solid var(--accent-blue)' : '3px solid transparent',
                    color: ledgerTab === 'profile' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <ClipboardList className="icon" style={{ fontSize: '16px' }} /> Borrower Profile
                </button>
                <button
                  type="button"
                  className="loan-file-tab"
                  onClick={() => setLedgerTab('guarantor')}
                  style={{
                    padding: '12px 16px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    background: 'none',
                    border: 'none',
                    borderBottom: ledgerTab === 'guarantor' ? '3px solid var(--accent-blue)' : '3px solid transparent',
                    color: ledgerTab === 'guarantor' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <ShieldCheck className="icon" style={{ fontSize: '16px' }} /> Guarantor Info
                </button>
                {user.role === 'admin' && (
                  <button
                    type="button"
                    className="loan-file-tab"
                    onClick={() => setLedgerTab('management')}
                    style={{
                      padding: '12px 16px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      background: 'none',
                      border: 'none',
                      borderBottom: ledgerTab === 'management' ? '3px solid var(--accent-blue)' : '3px solid transparent',
                      color: ledgerTab === 'management' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <Settings className="icon" style={{ fontSize: '16px' }} /> Manage Loan
                  </button>
                )}
              </div>

              {/* TAB 1: PASSBOOK & PAYMENTS */}
              {ledgerTab === 'passbook' && (
                <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {loanStatement.loan.collection_mode === 'fixed_term' && loanStatement.loan.maturity_date && (
                    <div className="glass-card">
                      <h3 style={{ fontSize: '18px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}><TrendingUp className="icon" /> Fixed Term Progress</h3>
                      {(() => {
                        const start = new Date(loanStatement.loan.created_at);
                        const maturity = new Date(loanStatement.loan.maturity_date);
                        const today = new Date();

                        let totalDays, currentDay;
                        if (loanStatement.loan.is_flat_installment) {
                          // Flat-installment loans store their true collection
                          // day count directly (duration_periods, e.g. 62) —
                          // deriving it from (maturity - start) instead gave
                          // the wrong denominator, since maturity_date is
                          // start + (periods - 1) days by design (collection
                          // starts on the disbursement day itself). Day
                          // numbering counts the disbursement day as Day 1,
                          // using calendar-day differences rather than raw
                          // elapsed hours, so "today" reads correctly
                          // regardless of what time of day the loan was
                          // disbursed at.
                          totalDays = loanStatement.loan.duration_periods || 1;
                          const startMidnight = new Date(start); startMidnight.setHours(0, 0, 0, 0);
                          const todayMidnight = new Date(today); todayMidnight.setHours(0, 0, 0, 0);
                          const daysSinceStart = Math.round((todayMidnight - startMidnight) / (1000 * 60 * 60 * 24));
                          currentDay = Math.min(totalDays, Math.max(1, daysSinceStart + 1));
                        } else {
                          totalDays = Math.max(1, Math.round((maturity - start) / (1000 * 60 * 60 * 24)));
                          const elapsedDays = Math.max(0, Math.round((today - start) / (1000 * 60 * 60 * 24)));
                          currentDay = Math.min(totalDays, elapsedDays);
                        }
                        const percent = Math.min(100, Math.max(0, (currentDay / totalDays) * 100));

                        return (
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                              <span>Disbursed: <strong>{start.toLocaleDateString()}</strong></span>
                              <span>Day {currentDay} of {totalDays} ({percent.toFixed(0)}%)</span>
                              <span>Maturity: <strong>{maturity.toLocaleDateString()}</strong></span>
                            </div>
                            <div style={{ width: '100%', height: '8px', background: 'var(--border-light)', borderRadius: '4px', overflow: 'hidden' }}>
                              <div style={{ width: `${percent}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-emerald))', transition: 'width 0.4s ease' }} />
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Mobile Sub-Tab Pills */}
                  <div className="mobile-only subtab-pill-bar" style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '8px' }}>
                    {(user.role === 'admin' || user.role === 'agent') && loanStatement.loan.status === 'active' && (
                      <button
                        type="button"
                        className={`subtab-pill ${passbookMobileTab === 'record' ? 'active' : ''}`}
                        onClick={() => setPassbookMobileTab('record')}
                      >
                        <Plus style={{ width: '14px', height: '14px' }} /> Record Payment
                      </button>
                    )}
                    <button
                      type="button"
                      className={`subtab-pill ${passbookMobileTab === 'activity' ? 'active' : ''}`}
                      onClick={() => setPassbookMobileTab('activity')}
                    >
                      <Receipt style={{ width: '14px', height: '14px' }} /> Activity Log ({displayEvents.length})
                    </button>
                    <button
                      type="button"
                      className={`subtab-pill ${passbookMobileTab === 'receipts' ? 'active' : ''}`}
                      onClick={() => setPassbookMobileTab('receipts')}
                    >
                      <Banknote style={{ width: '14px', height: '14px' }} /> Receipts ({loanStatement.payments.length})
                    </button>
                    <button
                      type="button"
                      className={`subtab-pill ${passbookMobileTab === 'accruals' ? 'active' : ''}`}
                      onClick={() => setPassbookMobileTab('accruals')}
                    >
                      <TrendingUp style={{ width: '14px', height: '14px' }} /> Interest Log ({relevantAccruals.length})
                    </button>
                  </div>

                  <div className="responsive-grid-2-col" style={{ gap: '24px' }}>
                    {/* Passbook Statement History */}
                    <div className={`glass-card ${passbookMobileTab !== 'activity' ? 'mobile-hidden' : ''}`} style={{ cursor: 'pointer', transition: 'transform 0.2s ease, border-color 0.2s ease' }} onClick={() => setView('passbook-details')}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: 'column', gap: '8px', marginBottom: '16px' }} className="mobile-header-split">
                        <h3 style={{ fontSize: '20px', margin: 0 }}><Receipt className="icon" /> Passbook Statement (Activity Log)</h3>
                        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '6px' }} onClick={(e) => { e.stopPropagation(); setView('passbook-details'); }}>
                          View Detailed Table
                        </button>
                      </div>
                      
                      {/* Desktop View Table */}
                      <div className="desktop-only" style={{ overflowX: 'auto' }}>
                        <table className="glass-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Activity</th>
                              <th>Details</th>
                              <th>Amount (+ / -)</th>
                              {showsUnifiedOutstanding(loanStatement.loan) ? (
                                <th>Total Outstanding</th>
                              ) : (
                                <>
                                  <th>Principal Bal.</th>
                                  <th>Interest Bal.</th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {displayEvents.map((entry, idx) => (
                              <tr key={idx}>
                                <td>{new Date(entry.date).toLocaleString()}</td>
                                <td>
                                  <span className={`badge ${entry.change === 'decrease' ? 'badge-active' : 'badge-pending'}`}>
                                    {entry.type}
                                  </span>
                                </td>
                                <td style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{entry.details}</td>
                                <td style={{
                                  fontWeight: 'bold',
                                  color: entry.change === 'decrease' ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                                }}>
                                  {entry.change === 'increase' ? `+ LKR ${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `- LKR ${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                </td>
                                {showsUnifiedOutstanding(loanStatement.loan) ? (
                                  <td style={{ fontWeight: 'bold' }}>
                                    LKR {(entry.runningPrincipalBalance + entry.runningInterestBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                ) : (
                                  <>
                                    <td style={{ fontWeight: 'bold' }}>
                                      LKR {entry.runningPrincipalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td style={{ fontWeight: 'bold' }}>
                                      LKR {entry.runningInterestBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile View Cards */}
                      <div className="mobile-only mobile-card-list">
                        {displayEvents.map((entry, idx) => (
                          <div key={idx} className={`mobile-row-card ${entry.change === 'decrease' ? 'mobile-row-card-success' : 'mobile-row-card-warning'}`}>
                            <div className="mobile-row-card-header">
                              <strong style={{ fontSize: '15px' }}>{entry.type}</strong>
                              <span className={`badge ${entry.change === 'decrease' ? 'badge-active' : 'badge-pending'}`}>
                                {entry.change === 'increase' ? 'Charged' : 'Paid'}
                              </span>
                            </div>
                            <div className="mobile-row-card-grid-compact">
                              <div>
                                <span className="mobile-row-card-label">Date:</span>
                                <span className="mobile-row-card-value">{new Date(entry.date).toLocaleDateString()}</span>
                              </div>
                              <div>
                                <span className="mobile-row-card-label">Change:</span>
                                <span className="mobile-row-card-value" style={{
                                  fontWeight: 'bold',
                                  color: entry.change === 'decrease' ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                                }}>
                                  {entry.change === 'increase' ? `+ LKR ${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `- LKR ${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                </span>
                              </div>
                              <div style={{ gridColumn: 'span 2' }}>
                                <span className="mobile-row-card-label">Description:</span>
                                <span className="mobile-row-card-value" style={{ fontSize: '13px' }}>{entry.details}</span>
                              </div>
                              {showsUnifiedOutstanding(loanStatement.loan) ? (
                                <div style={{ gridColumn: 'span 2', borderTop: '1px solid #f1f5f9', paddingTop: '4px', marginTop: '4px' }}>
                                  <span className="mobile-row-card-label">Total Outstanding:</span>
                                  <span className="mobile-row-card-value" style={{ fontWeight: 'bold' }}> LKR {(entry.runningPrincipalBalance + entry.runningInterestBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                              ) : (
                                <>
                                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '4px', marginTop: '4px' }}>
                                    <span className="mobile-row-card-label">Principal Bal:</span>
                                    <span className="mobile-row-card-value" style={{ fontWeight: 'bold' }}> LKR {entry.runningPrincipalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  </div>
                                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '4px', marginTop: '4px' }}>
                                    <span className="mobile-row-card-label">Interest Bal:</span>
                                    <span className="mobile-row-card-value" style={{ fontWeight: 'bold' }}> LKR {entry.runningInterestBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Payments & Interest History split */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      
                      {/* Record Payment inline card */}
                      {(user.role === 'admin' || user.role === 'agent') && loanStatement.loan.status === 'active' && (
                        <div className={`glass-card ${passbookMobileTab !== 'record' ? 'mobile-hidden' : ''}`} onClick={(e) => e.stopPropagation()} style={{ border: '1px solid var(--border-light)', background: 'rgba(255, 255, 255, 0.01)' }}>
                          <h3 style={{ fontSize: '18px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Banknote className="icon" style={{ color: 'var(--accent-blue)' }} /> Record a Payment
                          </h3>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '14px' }}>
                            Enter cash collection details for this loan.
                          </p>
                          <form onSubmit={handleLedgerCollectPayment} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                              <label id="f-ledger-payment-type" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Payment Type</label>
                              {loanStatement.loan.is_flat_installment ? (
                                <div aria-labelledby="f-ledger-payment-type" className="glass-btn glass-btn-emerald" style={{ width: '100%', padding: '8px 12px', fontSize: '12px', textAlign: 'center', cursor: 'default' }}>
                                  Principal + Interest (Flat Installment)
                                </div>
                              ) : (
                                <div role="group" aria-labelledby="f-ledger-payment-type" style={{ display: 'flex', gap: '8px' }}>
                                  <button type="button"
                                    className={`glass-btn ${ledgerPaymentForm.payment_type === 'interest' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
                                    style={{ flex: 1, padding: '8px 12px', fontSize: '12px' }}
                                    onClick={() => setLedgerPaymentForm(prev => ({ ...prev, payment_type: 'interest' }))}>
                                    Interest
                                  </button>
                                  <button type="button"
                                    className={`glass-btn ${ledgerPaymentForm.payment_type === 'principal' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
                                    style={{ flex: 1, padding: '8px 12px', fontSize: '12px' }}
                                    onClick={() => setLedgerPaymentForm(prev => ({ ...prev, payment_type: 'principal' }))}>
                                    Principal
                                  </button>
                                </div>
                              )}
                              {loanStatement.loan.is_flat_installment && (
                                <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>
                                  Daily installment due: LKR {parseFloat(loanStatement.loan.daily_installment_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                              )}
                            </div>

                            <div>
                              <label htmlFor="f-amount-lkr-6768" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Amount (LKR) *</label>
                              <input id="f-amount-lkr-6768" required type="number" inputMode="decimal" step="0.01" min="0.01" className="glass-input" placeholder="0.00"
                                value={ledgerPaymentForm.amount}
                                onChange={e => setLedgerPaymentForm(prev => ({ ...prev, amount: e.target.value }))}
                                style={{ padding: '10px 12px', fontSize: '16px', fontWeight: 'bold' }} />
                              {/* Quick-fill chips */}
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                                {loanStatement.loan.is_flat_installment && parseFloat(loanStatement.loan.daily_installment_amount) > 0 && (
                                  <button type="button" className="quick-amt-chip emerald" onClick={() => setLedgerPaymentForm(prev => ({ ...prev, amount: parseFloat(loanStatement.loan.daily_installment_amount).toString() }))}>
                                    ⚡ Installment (LKR {parseFloat(loanStatement.loan.daily_installment_amount).toLocaleString()})
                                  </button>
                                )}
                                {!loanStatement.loan.is_flat_installment && parseFloat(loanStatement.loan.interest_balance) > 0 && (
                                  <button type="button" className="quick-amt-chip emerald" onClick={() => setLedgerPaymentForm(prev => ({ ...prev, payment_type: 'interest', amount: parseFloat(loanStatement.loan.interest_balance).toString() }))}>
                                    Interest Due (LKR {parseFloat(loanStatement.loan.interest_balance).toLocaleString()})
                                  </button>
                                )}
                                {!loanStatement.loan.is_flat_installment && parseFloat(loanStatement.loan.principal_outstanding) > 0 && (
                                  <button type="button" className="quick-amt-chip" onClick={() => setLedgerPaymentForm(prev => ({ ...prev, payment_type: 'principal', amount: parseFloat(loanStatement.loan.principal_outstanding).toString() }))}>
                                    Full Principal (LKR {parseFloat(loanStatement.loan.principal_outstanding).toLocaleString()})
                                  </button>
                                )}
                              </div>
                            </div>

                            <div>
                              <label htmlFor="f-notes-description-6776" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Notes / Description</label>
                              <input id="f-notes-description-6776" type="text" className="glass-input" placeholder="e.g. Week 2 payment"
                                value={ledgerPaymentForm.notes}
                                onChange={e => setLedgerPaymentForm(prev => ({ ...prev, notes: e.target.value }))}
                                style={{ padding: '8px 12px', fontSize: '13px' }} />
                            </div>

                            <div>
                              <label htmlFor="f-receipt-photo-proof-6784" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 'bold' }}>Receipt Photo / Proof (Optional — Camera / File)</label>
                              <input id="f-receipt-photo-proof-6784" type="file" accept="image/*" capture="environment" className="glass-input"
                                onChange={async (e) => {
                                  const file = e.target.files[0];
                                  if (file) {
                                    const reader = new FileReader();
                                    reader.onloadend = () => {
                                      setLedgerPaymentForm(prev => ({ ...prev, proof_image: reader.result }));
                                    };
                                    reader.readAsDataURL(file);
                                  }
                                }}
                                style={{ padding: '6px', fontSize: '12px' }} />
                            </div>

                            <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ width: '100%', padding: '12px', fontSize: '15px', marginTop: '4px' }}>
                              Collect Payment
                            </button>
                          </form>
                        </div>
                      )}

                      {/* Collection Receipts ledger */}
                      <div className={`glass-card ${passbookMobileTab !== 'receipts' ? 'mobile-hidden' : ''}`}>
                        <h3 style={{ fontSize: '18px', marginBottom: '14px' }}><Banknote className="icon" /> Payments Received</h3>
                        {loanStatement.payments.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No payments collected yet.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
                            {loanStatement.payments.map((p, idx) => (
                              <div key={idx} style={{ padding: '12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px' }}>
                                  <span>Received by <strong>{p.agent_name || 'Office'}</strong></span>
                                  <span style={{ color: 'var(--text-muted)' }}>{new Date(p.payment_date).toLocaleDateString()}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                  <strong style={{ color: 'var(--accent-emerald)', fontSize: '15px' }}>LKR {parseFloat(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <button type="button" className="glass-btn btn-whatsapp" style={{ padding: '5px 10px', fontSize: '11px', borderRadius: '6px', backgroundColor: '#25D366', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold' }} onClick={() => {
                                      handleShareWhatsAppReceipt({
                                        ...p,
                                        borrower_name: loanStatement.loan.borrower_name,
                                        borrower_phone: loanStatement.loan.borrower_phone,
                                        loan_principal: loanStatement.loan.principal_amount,
                                        loan_interest_rate: loanStatement.loan.interest_rate,
                                        loan_interest_type: loanStatement.loan.interest_type,
                                        loan_principal_outstanding: loanStatement.loan.principal_outstanding,
                                        loan_interest_balance: loanStatement.loan.interest_balance
                                      });
                                    }}>
                                      <MessageSquare className="icon" style={{ width: '12px', height: '12px' }} /> WhatsApp
                                    </button>
                                    <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '5px 10px', fontSize: '11px', borderRadius: '6px' }} onClick={() => {
                                      handleOpenReceipt(p, {
                                        borrowerName: loanStatement.loan.borrower_name,
                                        borrowerPhone: loanStatement.loan.borrower_phone,
                                        loanPrincipal: loanStatement.loan.principal_amount,
                                        loanInterestRate: loanStatement.loan.interest_rate,
                                        loanInterestType: loanStatement.loan.interest_type,
                                        loanPrincipalOutstanding: loanStatement.loan.principal_outstanding,
                                        loanInterestBalance: loanStatement.loan.interest_balance
                                      });
                                    }}>
                                      <Printer className="icon" /> Print
                                    </button>
                                  </div>
                                </div>
                                {p.notes && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>"{p.notes}"</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Accrued Interest list */}
                      <div className={`glass-card ${passbookMobileTab !== 'accruals' ? 'mobile-hidden' : ''}`}>
                        <h3 style={{ fontSize: '18px', marginBottom: '14px' }}><TrendingUp className="icon" /> Interest Charged History</h3>
                        {relevantAccruals.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                            {loanStatement.loan.is_flat_installment ? 'Not applicable — flat installment loans bundle interest into the fixed daily amount.' : 'No interest accrued yet.'}
                          </p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
                            {relevantAccruals.map((acc, idx) => (
                              <div key={idx} style={{ padding: '12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                  <span>Accrued Date</span>
                                  <span>{new Date(acc.created_at).toLocaleDateString()}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <strong style={{ color: 'var(--accent-gold)' }}>+ LKR {parseFloat(acc.amount_accrued).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                                </div>
                                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'monospace' }}>{acc.calculation_log}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: BORROWER PROFILE */}
              {ledgerTab === 'profile' && (
                <div className="animate-fade-in">
                  {(loanStatement.loan.loan_purpose || loanStatement.loan.dependents_count !== null || loanStatement.loan.monthly_income !== null || loanStatement.loan.spouse_name || loanStatement.loan.borrower_address) ? (
                    <div className="glass-card">
                      <h3 style={{ fontSize: '22px', marginBottom: '16px' }}><ClipboardList className="icon" /> Borrower Profile Details</h3>
                      <div className="responsive-grid-2-col" style={{ rowGap: '10px' }}>
                        <div style={{ gridColumn: '1 / -1' }}><strong>Address:</strong> {loanStatement.loan.borrower_address || '-'}</div>
                        <div><strong>Date of Birth:</strong> {loanStatement.loan.date_of_birth ? new Date(loanStatement.loan.date_of_birth).toLocaleDateString() : '-'}</div>
                        <div style={{ gridColumn: '1 / -1' }}><strong>Purpose of Loan:</strong> {loanStatement.loan.loan_purpose || '-'}</div>
                        <div><strong>Dependents:</strong> {loanStatement.loan.dependents_count ?? '-'}</div>
                        <div><strong>Monthly Income:</strong> {loanStatement.loan.monthly_income !== null && loanStatement.loan.monthly_income !== undefined ? `LKR ${parseFloat(loanStatement.loan.monthly_income).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}</div>
                        <div><strong>Spouse Name:</strong> {loanStatement.loan.spouse_name || '-'}</div>
                        <div><strong>Spouse NIC:</strong> {loanStatement.loan.spouse_nic || '-'}</div>
                        <div style={{ gridColumn: '1 / -1' }}><strong>Spouse Occupation:</strong> {loanStatement.loan.spouse_occupation || '-'}</div>
                      </div>
                      {(loanStatement.loan.photo_proof_urls?.length > 0 || loanStatement.loan.address_proof_url) && (
                        <div style={{ marginTop: '14px' }}>
                          <strong style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>Photo Proof:</strong>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {(loanStatement.loan.photo_proof_urls?.length > 0 ? loanStatement.loan.photo_proof_urls : [loanStatement.loan.address_proof_url]).map((url, idx) => (
                              <img key={idx} src={url} alt={`Borrower photo proof ${idx + 1}`} style={{ width: '160px', height: '105px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-glass)' }} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="glass-card">
                      <h3 style={{ fontSize: '22px', marginBottom: '8px' }}><ClipboardList className="icon" /> Borrower Profile Details</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>No profile details are on file for this borrower.</p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: GUARANTOR INFO */}
              {ledgerTab === 'guarantor' && (
                <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {(loanStatement.guarantors || []).map((gtor, gi) => (
                    <div className="glass-card" key={gtor.id || gi}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '22px', margin: 0 }}><ShieldCheck className="icon" /> Guarantor Details {loanStatement.guarantors.length > 1 ? `(${gi + 1} of ${loanStatement.guarantors.length})` : ''}</h3>
                        {/* Edit/Remove only supported for a single-guarantor loan — the
                            underlying API operates on "the" guarantor for a loan_id and
                            can't disambiguate between several. */}
                        {user.role === 'admin' && loanStatement.guarantors.length === 1 && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '4px' }} onClick={() => handleOpenGuarantorEditor(gtor)}>
                              Edit Guarantor
                            </button>
                            <button className="glass-btn glass-btn-rose" style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '4px' }} onClick={handleRemoveGuarantor}>
                              <Trash2 className="icon" /> Remove
                            </button>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
                        {(gtor.nic_photo_urls?.length > 0 ? gtor.nic_photo_urls : (gtor.nic_photo_url ? [gtor.nic_photo_url] : [])).map((url, idx) => (
                          <div key={`nic-${idx}`}>
                            <span style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>NIC Photo{idx > 0 ? ` ${idx + 1}` : ''}</span>
                            <img src={url} alt={`${gtor.full_name} NIC ${idx + 1}`} style={{ width: '110px', height: '72px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-glass)' }} />
                          </div>
                        ))}
                        {/* No Photo Proof for guarantors — NIC Photo above is the only
                            photo collected/shown for a guarantor now. */}
                      </div>
                      <div className="responsive-grid-2-col" style={{ rowGap: '10px' }}>
                        <div><strong>Name:</strong> {gtor.full_name}</div>
                        <div><strong>NIC:</strong> {gtor.nic_number}</div>
                        <div><strong>Phone:</strong> {gtor.phone}</div>
                        <div style={{ gridColumn: '1 / -1' }}><strong>Address:</strong> {gtor.address}</div>
                        <div>
                          <strong>Protected under debt-recovery act:</strong>{' '}
                          <span style={{ color: gtor.protected_under_debt_act ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
                            {gtor.protected_under_debt_act ? 'Yes' : 'No'}
                          </span>
                        </div>
                        <div>
                          <strong>Pending court cases:</strong>{' '}
                          <span style={{ color: gtor.has_pending_court_cases ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
                            {gtor.has_pending_court_cases ? 'Yes' : 'No'}
                          </span>
                        </div>
                      </div>
                      <div style={{ marginTop: '14px', display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '14px' }}>
                        <div>
                          <strong>Monthly Income:</strong> LKR {(
                            parseFloat(gtor.monthly_income_business || 0) +
                            parseFloat(gtor.monthly_income_agriculture || 0) +
                            parseFloat(gtor.monthly_income_other || 0)
                          ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}> (Business: {parseFloat(gtor.monthly_income_business || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, Agriculture: {parseFloat(gtor.monthly_income_agriculture || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, Other: {parseFloat(gtor.monthly_income_other || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                        </div>
                        <div>
                          <strong>Monthly Expense:</strong> LKR {(
                            parseFloat(gtor.monthly_expense_food || 0) +
                            parseFloat(gtor.monthly_expense_rent || 0) +
                            parseFloat(gtor.monthly_expense_other || 0)
                          ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}> (Food: {parseFloat(gtor.monthly_expense_food || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, Rent: {parseFloat(gtor.monthly_expense_rent || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, Other: {parseFloat(gtor.monthly_expense_other || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {(!loanStatement.guarantors || loanStatement.guarantors.length === 0) && user.role === 'admin' && (
                    <div className="glass-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                        <div>
                          <h3 style={{ fontSize: '22px', margin: '0 0 4px' }}><ShieldCheck className="icon" /> Guarantor Details</h3>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>No guarantor is on file for this loan.</p>
                        </div>
                        <button className="glass-btn glass-btn-emerald" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={() => handleOpenGuarantorEditor(null)}>
                          <ShieldCheck className="icon" /> Add Guarantor
                        </button>
                      </div>
                    </div>
                  )}

                  {showGuarantorEditor && (
                    <div className="glass-card">
                      <h3 style={{ fontSize: '22px', marginBottom: '16px' }}><ShieldCheck className="icon" /> {loanStatement.guarantor ? 'Edit' : 'Add'} Guarantor</h3>
                      <form onSubmit={handleSaveGuarantor} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div className="form-grid-2-col">
                          <div>
                            <label htmlFor="f-full-name-7014" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Full Name *</label>
                            <input id="f-full-name-7014" required type="text" className="glass-input" value={guarantorEditForm.full_name} onChange={e => setGuarantorEditForm(prev => ({ ...prev, full_name: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="f-nic-number-7018" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>NIC Number *</label>
                            <input id="f-nic-number-7018" required type="text" className="glass-input" placeholder="e.g. 199012345678 or 123456789V" value={guarantorEditForm.nic_number} onChange={e => setGuarantorEditForm(prev => ({ ...prev, nic_number: e.target.value }))} onBlur={e => runNicLookup('guarantor_edit', e.target.value)} />
                            {nicLookup.guarantor_edit?.loading && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>Checking record…</span>}
                            {renderNicLookupWarning('guarantor_edit', { forGuarantee: true })}
                          </div>
                        </div>
                        <div>
                          <label htmlFor="f-phone-7025" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Phone *</label>
                          <input id="f-phone-7025" required type="tel" className="glass-input" value={guarantorEditForm.phone} onChange={e => setGuarantorEditForm(prev => ({ ...prev, phone: e.target.value }))} />
                        </div>
                        <div>
                          <label htmlFor="f-address-7029" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Address (Optional)</label>
                          <input id="f-address-7029" type="text" className="glass-input" value={guarantorEditForm.address} onChange={e => setGuarantorEditForm(prev => ({ ...prev, address: e.target.value }))} />
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                          <input type="checkbox" checked={guarantorEditForm.protected_under_debt_act} onChange={e => setGuarantorEditForm(prev => ({ ...prev, protected_under_debt_act: e.target.checked }))} />
                          Protected under debt-recovery act
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                          <input type="checkbox" checked={guarantorEditForm.has_pending_court_cases} onChange={e => setGuarantorEditForm(prev => ({ ...prev, has_pending_court_cases: e.target.checked }))} />
                          Has pending court cases
                        </label>
                        <p style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-secondary)', margin: '4px 0 -4px' }}>Monthly Income (LKR)</p>
                        <div className="form-grid-2-col">
                          <input type="number" min="0" className="glass-input" placeholder="Business" value={guarantorEditForm.monthly_income_business} onChange={e => setGuarantorEditForm(prev => ({ ...prev, monthly_income_business: e.target.value }))} />
                          <input type="number" min="0" className="glass-input" placeholder="Agriculture" value={guarantorEditForm.monthly_income_agriculture} onChange={e => setGuarantorEditForm(prev => ({ ...prev, monthly_income_agriculture: e.target.value }))} />
                        </div>
                        <input type="number" min="0" className="glass-input" placeholder="Other" value={guarantorEditForm.monthly_income_other} onChange={e => setGuarantorEditForm(prev => ({ ...prev, monthly_income_other: e.target.value }))} />
                        <p style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-secondary)', margin: '4px 0 -4px' }}>Monthly Expense (LKR)</p>
                        <div className="form-grid-2-col">
                          <input type="number" min="0" className="glass-input" placeholder="Food" value={guarantorEditForm.monthly_expense_food} onChange={e => setGuarantorEditForm(prev => ({ ...prev, monthly_expense_food: e.target.value }))} />
                          <input type="number" min="0" className="glass-input" placeholder="House Rent" value={guarantorEditForm.monthly_expense_rent} onChange={e => setGuarantorEditForm(prev => ({ ...prev, monthly_expense_rent: e.target.value }))} />
                        </div>
                        <input type="number" min="0" className="glass-input" placeholder="Other" value={guarantorEditForm.monthly_expense_other} onChange={e => setGuarantorEditForm(prev => ({ ...prev, monthly_expense_other: e.target.value }))} />
                        <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                          <button type="submit" className="glass-btn glass-btn-emerald" disabled={loading} style={{ flex: 1 }}>Save Guarantor</button>
                          <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setShowGuarantorEditor(false)}>Cancel</button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: MANAGE LOAN */}
              {ledgerTab === 'management' && user.role === 'admin' && (
                <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {loanStatement.loan.status === 'active' && (
                    <div className="glass-card">
                      <h3 style={{ fontSize: '22px', marginBottom: '16px' }}><Settings className="icon" /> Loan Management</h3>
                      <div className="responsive-grid-2-col" style={{ gap: '20px' }}>
                        <div>
                          <h4 style={{ fontSize: '15px', marginBottom: '10px' }}>Edit Terms</h4>
                          <form onSubmit={handleUpdateLoan} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div>
                              <label htmlFor="f-new-interest-rate-currently-loanstatemen-7073" style={{ fontSize: '12px', fontWeight: 'bold' }}>New Interest Rate (%) — currently {loanStatement.loan.interest_rate}%</label>
                              <input id="f-new-interest-rate-currently-loanstatemen-7073" type="number" step="0.01" min="0" className="glass-input" placeholder="Leave blank to keep unchanged"
                                value={loanEditForm.interest_rate}
                                onChange={e => setLoanEditForm(prev => ({ ...prev, interest_rate: e.target.value }))} />
                            </div>
                            <div>
                              <label htmlFor="f-reassign-agent-7079" style={{ fontSize: '12px', fontWeight: 'bold' }}>Reassign Agent</label>
                              <select id="f-reassign-agent-7079" className="glass-input" value={loanEditForm.assigned_agent_id}
                                onChange={e => setLoanEditForm(prev => ({ ...prev, assigned_agent_id: e.target.value }))}>
                                <option value="">Leave unchanged</option>
                                {agentsList.map(a => (
                                  <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                              </select>
                            </div>
                            <button type="submit" className="glass-btn glass-btn-secondary" disabled={loading} style={{ width: '100%' }}>Save Changes</button>
                          </form>

                          {/* Restructuring, deliberately scoped to term
                              only — the payment amount never changes here,
                              only how long the borrower has to keep making
                              it. Only shown for fixed_term loans; an
                              open-ended loan has no term to extend. */}
                          {loanStatement.loan.collection_mode === 'fixed_term' && (
                            <div style={{ marginTop: '20px' }}>
                              <h4 style={{ fontSize: '15px', marginBottom: '6px' }}>Extend Loan Term</h4>
                              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px' }}>
                                For a borrower who's fallen behind and needs more time. Gives more calendar days/weeks/months to finish paying — the {loanStatement.loan.is_flat_installment ? 'daily' : loanStatement.loan.interest_type} payment amount stays exactly the same.
                                {loanStatement.loan.maturity_date && <> Current end date: <strong>{new Date(loanStatement.loan.maturity_date).toLocaleDateString()}</strong>.</>}
                              </p>
                              <button type="button" className="glass-btn glass-btn-secondary" disabled={loading} onClick={handleExtendLoanTerm} style={{ width: '100%' }}>
                                <Calendar className="icon" /> Extend Term
                              </button>
                            </div>
                          )}
                        </div>

                        <div>
                          <h4 style={{ fontSize: '15px', marginBottom: '10px' }}>Apply Late Fee / Penalty</h4>
                          <form onSubmit={handleApplyPenalty} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <input type="number" min="1" className="glass-input" placeholder="Penalty amount (LKR)"
                              value={penaltyForm.amount}
                              onChange={e => setPenaltyForm(prev => ({ ...prev, amount: e.target.value }))} />
                            <input type="text" className="glass-input" placeholder="Reason (optional)"
                              value={penaltyForm.reason}
                              onChange={e => setPenaltyForm(prev => ({ ...prev, reason: e.target.value }))} />
                            <button type="submit" className="glass-btn glass-btn-secondary" disabled={loading} style={{ width: '100%' }}>Apply Penalty</button>
                          </form>

                          <h4 style={{ fontSize: '15px', margin: '16px 0 10px' }}>Mark as Defaulted</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <input type="text" className="glass-input" placeholder="Reason for default (required)"
                              value={defaultReason}
                              onChange={e => setDefaultReason(e.target.value)} />
                            <button type="button" className="glass-btn glass-btn-rose" disabled={loading} onClick={() => {
                              openActionModal({
                                title: 'Mark Loan as Defaulted',
                                message: 'This will block further payment collection.',
                                confirmLabel: 'Mark Defaulted',
                                danger: true,
                                onConfirm: async () => { await handleMarkDefaulted(); },
                              });
                            }}>
                              <Ban className="icon" /> Mark Defaulted
                            </button>
                          </div>

                          <h4 style={{ fontSize: '15px', margin: '16px 0 10px' }}>Write Off as Bad Debt</h4>
                          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px' }}>Permanently closes this loan and posts the remaining balance to the ledger as unrecoverable. Use only when the debt will never be collected.</p>
                          <button type="button" className="glass-btn glass-btn-rose" disabled={loading} onClick={handleWriteOffLoan} style={{ width: '100%' }}>
                            <Ban className="icon" /> Write Off Loan
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {loanStatement.loan.status === 'defaulted' && (
                    <div className="glass-card">
                      <h3 style={{ fontSize: '22px', marginBottom: '8px' }}><Settings className="icon" /> Loan Management</h3>
                      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
                        This loan is defaulted (Reason: {loanStatement.loan.default_reason || 'N/A'}). No payments can be recorded until it's reinstated.
                      </p>
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button type="button" className="glass-btn glass-btn-emerald" disabled={loading} onClick={handleReinstateLoan}>
                          <RefreshCcw className="icon" /> Reinstate to Active
                        </button>
                        <button type="button" className="glass-btn glass-btn-rose" disabled={loading} onClick={handleWriteOffLoan}>
                          <Ban className="icon" /> Write Off as Bad Debt
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Delete Loan — only ever possible for a loan with zero real
                      payments/interest accruals (checked here for UX, and
                      authoritatively re-checked server-side; the database's
                      own ON DELETE RESTRICT constraint is the final backstop).
                      Not shown at all once a loan has real activity — Write
                      Off above is what closes those out. */}
                  {loanStatement.payments.length === 0 && loanStatement.accruals.length === 0 && (
                    <div className="glass-card" style={{ borderColor: 'var(--accent-rose)' }}>
                      <h3 style={{ fontSize: '18px', marginBottom: '8px', color: 'var(--accent-rose)' }}><Trash2 className="icon" /> Danger Zone</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 12px' }}>
                        This loan has no payments or interest accruals recorded against it yet — safe to permanently delete if it was created by mistake or was test data. Once it has any real activity, this option disappears and Write Off is the only way to close it out.
                      </p>
                      <button type="button" className="glass-btn glass-btn-rose" disabled={loading} onClick={() => setShowDeleteLoanModal(true)}>
                        <Trash2 className="icon" /> Delete This Loan
                      </button>
                    </div>
                  )}
                </div>
              )}

            </div>
          );
        })()
      )}

      {/* ----------------- CHRONOLOGICAL DETAILED PASSBOOK TABLE PAGE ----------------- */}
      {token && user && view === 'passbook-details' && (
        !loanStatement ? (
          <div className="glass-card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '16px' }}>
            <div className="loading-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Loading passbook details...</p>
          </div>
        ) : (() => {
          // Event compilation (chronological order). See the same
          // relevantAccruals note in the 'ledger' view above — flat
          // installment loans never accrue interest_accrual rows going
          // forward, so any that exist here are pre-conversion leftovers
          // and are excluded from this loan's activity log.
          const relevantAccruals = loanStatement.loan.is_flat_installment ? [] : loanStatement.accruals;
          // See the matching principalDelta/interestDelta comment in the
          // 'ledger' view above — a flat-installment payment moves both
          // balances in one collection, which the old single-bucket shape
          // couldn't represent (it silently froze Principal Bal and drove
          // Interest Bal deeply negative for every flat-installment loan).
          // Also seeds the interest bucket at disbursement for flat loans
          // (they never get "Interest Added" accrual events to build it up
          // gradually the way non-flat loans do) — see the same seeding
          // comment in the 'ledger' view above.
          const flatTotalInterest = loanStatement.loan.is_flat_installment
            ? (parseFloat(loanStatement.loan.daily_installment_amount) || 0) * (parseFloat(loanStatement.loan.duration_periods) || 0) - (parseFloat(loanStatement.loan.principal_amount) || 0)
            : 0;
          const events = [
            {
              date: loanStatement.loan.created_at,
              type: 'Loan Disbursed',
              amount: parseFloat(loanStatement.loan.principal_amount),
              principalDelta: parseFloat(loanStatement.loan.principal_amount),
              interestDelta: flatTotalInterest,
              details: loanStatement.loan.is_flat_installment
                ? `Initial principal loan amount (plus LKR ${flatTotalInterest.toLocaleString(undefined, { minimumFractionDigits: 2 })} total interest for the full term, fixed at disbursement)`
                : 'Initial principal loan amount'
            },
            ...relevantAccruals.map(acc => ({
              date: acc.created_at,
              type: 'Interest Added',
              amount: parseFloat(acc.amount_accrued),
              principalDelta: 0,
              interestDelta: parseFloat(acc.amount_accrued),
              details: acc.calculation_log
            })),
            ...loanStatement.payments.map(p => {
              const amt = parseFloat(p.amount);
              let principalDelta = 0, interestDelta = 0, type;
              if (p.payment_type === 'flat_installment') {
                principalDelta = -(parseFloat(p.principal_component) || 0);
                interestDelta = -(parseFloat(p.interest_component) || 0);
                type = 'Installment Payment';
              } else if (p.payment_type === 'principal') {
                principalDelta = -amt;
                type = 'Principal Payment';
              } else {
                interestDelta = -amt;
                type = 'Interest Payment';
              }
              return {
                date: p.payment_date,
                type,
                amount: amt,
                principalDelta,
                interestDelta,
                details: `Cash collected by ${p.agent_name} ${p.notes ? ` - "${p.notes}"` : ''}`
              };
            }),
            ...loanStatement.ledger.filter(l => l.account === 'penalty_revenue').map(l => ({
              date: l.created_at,
              type: 'Penalty Applied',
              amount: parseFloat(l.amount),
              principalDelta: 0,
              interestDelta: parseFloat(l.amount),
              details: 'Manual late fee / penalty charged by admin'
            }))
          ];

          events.sort((a, b) => new Date(a.date) - new Date(b.date));

          let principalBal = 0;
          let interestBal = 0;
          const displayEvents = events.map(ev => {
            principalBal += ev.principalDelta;
            interestBal += ev.interestDelta;
            return {
              ...ev,
              change: (ev.principalDelta + ev.interestDelta) >= 0 ? 'increase' : 'decrease',
              runningPrincipalBalance: principalBal,
              runningInterestBalance: interestBal
            };
          });

          return (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <span style={{ fontSize: '11px', color: 'var(--accent-blue)', fontWeight: 'bold', letterSpacing: '0.05em' }}>DETAILED PASSBOOK STATEMENT</span>
                  <h2 style={{ fontSize: '28px', margin: '4px 0' }}>{loanStatement.loan.borrower_name}</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>
                    NIC: <strong>{loanStatement.loan.nic_number || 'N/A'}</strong> | Phone: <strong>{loanStatement.loan.borrower_phone}</strong>
                  </p>
                </div>
                
                {/* Actions group with flex layout */}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', width: '100%', maxWidth: '380px' }}>
                  <button type="button" className="glass-btn glass-btn-secondary" style={{ flex: 1, minWidth: '160px', padding: '10px 16px', display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => window.print()}>
                    <Printer className="icon" /> Print Statement
                  </button>
                  <button type="button" className="glass-btn glass-btn-emerald" style={{ flex: 1, minWidth: '160px', padding: '10px 16px', display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setView('ledger')}>
                    <ArrowLeft className="icon" /> Back to Loan File
                  </button>
                </div>
              </div>

              <div className="glass-card" style={{ padding: '24px' }}>
                
                {/* Desktop View Table */}
                <div className="desktop-only" style={{ overflowX: 'auto' }}>
                  <table className="glass-table">
                    <thead>
                      {showsUnifiedOutstanding(loanStatement.loan) ? (
                        <tr>
                          <th style={{ width: '18%' }}>Date/Time</th>
                          <th style={{ width: '18%' }}>Event Type</th>
                          <th style={{ width: '34%' }}>Calculation Details / Log</th>
                          <th style={{ width: '15%', textAlign: 'right' }}>Amount (+ / -)</th>
                          <th style={{ width: '15%', textAlign: 'right' }}>Total Outstanding</th>
                        </tr>
                      ) : (
                        <tr>
                          <th style={{ width: '15%' }}>Date/Time</th>
                          <th style={{ width: '15%' }}>Event Type</th>
                          <th style={{ width: '30%' }}>Calculation Details / Log</th>
                          <th style={{ width: '13%', textAlign: 'right' }}>Principal Change</th>
                          <th style={{ width: '13%', textAlign: 'right' }}>Principal Balance</th>
                          <th style={{ width: '13%', textAlign: 'right' }}>Interest Change</th>
                          <th style={{ width: '13%', textAlign: 'right' }}>Interest Balance</th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {displayEvents.map((entry, idx) => (
                        <tr key={idx}>
                          <td style={{ fontSize: '13px' }}>{new Date(entry.date).toLocaleString()}</td>
                          <td>
                            <span className={`badge ${entry.change === 'decrease' ? 'badge-active' : 'badge-pending'}`}>
                              {entry.type}
                            </span>
                          </td>
                          <td style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                            {entry.details}
                          </td>
                          {showsUnifiedOutstanding(loanStatement.loan) ? (
                            <>
                              <td style={{
                                textAlign: 'right',
                                fontWeight: 'bold',
                                color: entry.change === 'decrease' ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                              }}>
                                {entry.change === 'increase' ? `+LKR ${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-LKR ${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                                LKR {(entry.runningPrincipalBalance + entry.runningInterestBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </>
                          ) : (
                            <>
                              <td style={{
                                textAlign: 'right',
                                fontWeight: 'bold',
                                color: entry.principalDelta !== 0 ? (entry.principalDelta < 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)') : 'inherit'
                              }}>
                                {entry.principalDelta !== 0 ? (entry.principalDelta > 0 ? `+LKR ${entry.principalDelta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-LKR ${Math.abs(entry.principalDelta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) : '-'}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                                LKR {entry.runningPrincipalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td style={{
                                textAlign: 'right',
                                fontWeight: 'bold',
                                color: entry.interestDelta !== 0 ? (entry.interestDelta < 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)') : 'inherit'
                              }}>
                                {entry.interestDelta !== 0 ? (entry.interestDelta > 0 ? `+LKR ${entry.interestDelta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-LKR ${Math.abs(entry.interestDelta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) : '-'}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                                LKR {entry.runningInterestBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile View Card List */}
                <div className="mobile-only mobile-card-list">
                  {displayEvents.map((entry, idx) => (
                    <div key={idx} className={`mobile-row-card ${entry.change === 'decrease' ? 'mobile-row-card-success' : 'mobile-row-card-warning'}`}>
                      <div className="mobile-row-card-header">
                        <strong style={{ fontSize: '15px' }}>{entry.type}</strong>
                        <span className={`badge ${entry.change === 'decrease' ? 'badge-active' : 'badge-pending'}`}>
                          {entry.change === 'increase' ? 'Charged' : 'Paid'}
                        </span>
                      </div>
                      <div className="mobile-row-card-grid-compact" style={{ gridTemplateColumns: '1fr' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          <strong>Date/Time:</strong> {new Date(entry.date).toLocaleString()}
                        </div>
                        {entry.details && (
                          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '6px 8px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                            <strong>Calc Log:</strong> {entry.details}
                          </div>
                        )}
                        {showsUnifiedOutstanding(loanStatement.loan) ? (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', marginTop: '4px' }}>
                            <div>
                              <span className="mobile-row-card-label" style={{ fontSize: '10px' }}>Amount:</span>
                              <span className="mobile-row-card-value" style={{
                                fontSize: '12px',
                                color: entry.change === 'decrease' ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                              }}>
                                {entry.change === 'increase' ? `+${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              </span>
                            </div>
                            <div>
                              <span className="mobile-row-card-label" style={{ fontSize: '10px' }}>Total Outstanding:</span>
                              <span className="mobile-row-card-value" style={{ fontSize: '12px' }}> LKR {(entry.runningPrincipalBalance + entry.runningInterestBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', marginTop: '4px' }}>
                            <div>
                              <span className="mobile-row-card-label" style={{ fontSize: '10px' }}>Principal Chg:</span>
                              <span className="mobile-row-card-value" style={{
                                fontSize: '12px',
                                color: entry.principalDelta !== 0 ? (entry.principalDelta < 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)') : 'inherit'
                              }}>
                                {entry.principalDelta !== 0 ? (entry.principalDelta > 0 ? `+${entry.principalDelta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-${Math.abs(entry.principalDelta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) : '-'}
                              </span>
                            </div>
                            <div>
                              <span className="mobile-row-card-label" style={{ fontSize: '10px' }}>Interest Chg:</span>
                              <span className="mobile-row-card-value" style={{
                                fontSize: '12px',
                                color: entry.interestDelta !== 0 ? (entry.interestDelta < 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)') : 'inherit'
                              }}>
                                {entry.interestDelta !== 0 ? (entry.interestDelta > 0 ? `+${entry.interestDelta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-${Math.abs(entry.interestDelta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) : '-'}
                              </span>
                            </div>
                            <div>
                              <span className="mobile-row-card-label" style={{ fontSize: '10px' }}>Principal Bal:</span>
                              <span className="mobile-row-card-value" style={{ fontSize: '12px' }}> LKR {entry.runningPrincipalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div>
                              <span className="mobile-row-card-label" style={{ fontSize: '10px' }}>Interest Bal:</span>
                              <span className="mobile-row-card-value" style={{ fontSize: '12px' }}> LKR {entry.runningInterestBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

              </div>
            </div>
          );
        })()
      )}

      </main>

      {/* "More" bottom sheet (admin, mobile) — gives every admin screen
          that only lived in the desktop-only top nav (display:none on
          mobile) a real, permanent path on a phone. Next Day Tasklist and
          Record Payment were at least reachable via the dashboard's menu
          grid; Payment History and Audit Log had NO mobile path at all
          before this — the desktop top nav was their only link. */}
      {showMoreMenu && (
        <div className="receipt-modal-overlay" onClick={() => setShowMoreMenu(false)}>
          <div ref={moreMenuModalRef} tabIndex={-1} className="receipt-modal-card" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="receipt-header">
              <div className="receipt-header-icon"><LayoutGrid /></div>
              <div className="receipt-title">More</div>
              <div className="receipt-subtitle">Jump to another screen</div>
            </div>
            {(() => {
              const go = (v) => () => { setView(v); setSelectedLoanId(null); setLoanStatement(null); setShowMoreMenu(false); };
              const goAgent = (sub) => () => { setView('dashboard'); setAgentSubView(sub); setShowMoreMenu(false); };
              const groups = user?.role === 'agent' ? [
                { title: 'My round', items: [
                  { label: 'Next Day Tasklist', Icon: Calendar, onClick: goAgent('next-day-tasklist') },
                  { label: 'Collection History', Icon: ScrollText, onClick: goAgent('history') },
                ] },
              ] : [
                { title: 'Daily work', items: [
                  { label: 'Borrower Applications', Icon: ClipboardCheck, badge: pendingIntakeCount, badgeClass: 'badge-pending', onClick: go('borrower-intakes') },
                  { label: 'Agent Route Progress', Icon: Users, onClick: go('agents') },
                  { label: 'Next Day Tasklist', Icon: Calendar, onClick: go('next-day-tasklist') },
                ] },
                { title: 'Money', items: [
                  { label: 'Users & Cash', Icon: Landmark, onClick: () => { openAdminTools(); setShowMoreMenu(false); } },
                  { label: 'Interest Accrual Center', Icon: TrendingUp, onClick: go('interest-center') },
                  { label: 'Payment History', Icon: Receipt, onClick: go('payment-history') },
                ] },
                { title: 'Records', items: [
                  { label: 'Audit Log', Icon: ScrollText, onClick: go('audit-log') },
                  { label: 'SMS Log', Icon: Smartphone, onClick: go('sms-log') },
                ] },
              ];
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {groups.map(group => (
                    <div key={group.title} role="group" aria-label={group.title} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>{group.title}</div>
                      {group.items.map(item => (
                        <button
                          key={item.label}
                          type="button"
                          className="glass-btn glass-btn-secondary"
                          style={{ justifyContent: 'flex-start', padding: '14px 16px', fontSize: '15px', minHeight: '48px' }}
                          onClick={item.onClick}
                        >
                          <item.Icon className="icon" /> {item.label}
                          {item.badge > 0 && <span className={`badge ${item.badgeClass}`} style={{ marginLeft: 'auto', padding: '1px 6px', fontSize: '12px' }}>{item.badge}</span>}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="receipt-actions" style={{ gridTemplateColumns: '1fr' }}>
              <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setShowMoreMenu(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Bottom Navigation Bar */}
      {token && user && view !== 'portal' && view !== 'pawn-dashboard' && (
        <nav className="bottom-nav-bar animate-fade-in">
          {user.role === 'admin' && (
            <>
              <button className={`bottom-nav-item ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setSelectedLoanId(null); setLoanStatement(null); }}>
                <span className="bottom-nav-icon"><Home /></span>
                <span className="bottom-nav-label">Home</span>
              </button>
              <button className={`bottom-nav-item ${view === 'loans' ? 'active' : ''}`} onClick={() => { setView('loans'); setSelectedLoanId(null); setLoanStatement(null); }} style={{ position: 'relative' }}>
                <span className="bottom-nav-icon"><Search /></span>
                <span className="bottom-nav-label">Loans</span>
                {adminData?.summary?.totalOverdue > 0 && (
                  <span className="badge badge-defaulted" style={{ position: 'absolute', top: '2px', right: '6px', padding: '1px 5px', fontSize: '10px' }} aria-label={`${adminData.summary.totalOverdue} overdue`}>
                    {adminData.summary.totalOverdue}
                  </span>
                )}
              </button>
              <button className={`bottom-nav-item ${view === 'create-loan' ? 'active' : ''}`} onClick={() => { setView('create-loan'); setSelectedLoanId(null); setLoanStatement(null); }}>
                <span className="bottom-nav-icon"><Banknote /></span>
                <span className="bottom-nav-label">Give Loan</span>
              </button>
              <button className={`bottom-nav-item ${view === 'record-payment' ? 'active' : ''}`} onClick={() => { setView('record-payment'); setSelectedLoanId(null); setLoanStatement(null); }}>
                <span className="bottom-nav-icon"><CreditCard /></span>
                <span className="bottom-nav-label">Record</span>
              </button>
              <button className={`bottom-nav-item ${['agents', 'admin-tools', 'borrower-intakes', 'next-day-tasklist', 'interest-center', 'payment-history', 'audit-log', 'sms-log'].includes(view) ? 'active' : ''}`} onClick={() => setShowMoreMenu(true)} style={{ position: 'relative' }}>
                <span className="bottom-nav-icon"><LayoutGrid /></span>
                <span className="bottom-nav-label">More</span>
                {pendingIntakeCount > 0 && (
                  <span className="badge badge-pending" style={{ position: 'absolute', top: '2px', right: '6px', padding: '1px 5px', fontSize: '10px' }} aria-label={`${pendingIntakeCount} pending applications`}>
                    {pendingIntakeCount}
                  </span>
                )}
              </button>
            </>
          )}
          {user.role === 'agent' && (
            <>
              <button className={`bottom-nav-item ${view === 'dashboard' && (agentSubView === 'collect' || agentSubView === 'record-payment') ? 'active' : ''}`} onClick={() => { setView('dashboard'); setAgentSubView('record-payment'); }}>
                <span className="bottom-nav-icon"><Banknote /></span>
                <span className="bottom-nav-label">Route</span>
              </button>
              <button className={`bottom-nav-item ${view === 'create-loan' ? 'active' : ''}`} onClick={() => { setView('create-loan'); setGiveLoanStep(1); }}>
                <span className="bottom-nav-icon"><Plus /></span>
                <span className="bottom-nav-label">Give Loan</span>
              </button>
              <button className={`bottom-nav-item ${view === 'dashboard' && agentSubView === 'remit' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setAgentSubView('remit'); }}>
                <span className="bottom-nav-icon"><Landmark /></span>
                <span className="bottom-nav-label">Remit</span>
              </button>
              <button className={`bottom-nav-item ${view === 'borrower-intakes' ? 'active' : ''}`} onClick={() => { setView('borrower-intakes'); setSelectedLoanId(null); setLoanStatement(null); }} style={{ position: 'relative' }}>
                <span className="bottom-nav-icon"><ClipboardCheck /></span>
                <span className="bottom-nav-label">Applications</span>
                {pendingIntakeCount > 0 && <span className="badge badge-pending" style={{ position: 'absolute', top: '2px', right: '6px', padding: '1px 5px', fontSize: '10px' }}>{pendingIntakeCount}</span>}
              </button>
              <button className={`bottom-nav-item ${view === 'dashboard' && (agentSubView === 'next-day-tasklist' || agentSubView === 'history') ? 'active' : ''}`} onClick={() => setShowMoreMenu(true)}>
                <span className="bottom-nav-icon"><LayoutGrid /></span>
                <span className="bottom-nav-label">More</span>
              </button>
            </>
          )}
          {user.role === 'borrower' && (
            <>
              <button className={`bottom-nav-item ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setSelectedLoanId(null); setLoanStatement(null); }}>
                <span className="bottom-nav-icon"><Home /></span>
                <span className="bottom-nav-label">Home</span>
              </button>
            </>
          )}
        </nav>
      )}
    </div>
  );
}

// Shimmering placeholder cards shown while a list-style loader is fetching —
// referenced by LoansLoader, AuditLogLoader, and PaymentHistoryLoader below.
function SkeletonCards({ count = 3, lines = 2 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card">
          {Array.from({ length: lines }).map((__, j) => (
            <span key={j} className="skeleton skeleton-line" />
          ))}
        </div>
      ))}
    </>
  );
}

// Last-5-days paid/not-paid streak, oldest -> newest (today on the right) —
// like a sports scorecard's recent form. Only rendered for loans that
// actually carry `last5Days` (daily-cadence loans — see GET /api/loans).
// 'before_loan' days (the loan didn't exist yet) render as a neutral dash
// rather than a red miss, since nothing was actually due that day.
function Last5DaysStreak({ last5Days }) {
  if (!last5Days || last5Days.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: '3px' }} title="Last 5 days">
      {last5Days.map((d) => {
        const isPaid = d.status === 'paid';
        const isBeforeLoan = d.status === 'before_loan';
        const bg = isBeforeLoan ? 'var(--bg-tertiary)' : isPaid ? 'var(--accent-emerald)' : 'var(--accent-rose)';
        return (
          <span
            key={d.date}
            title={`${new Date(d.date).toLocaleDateString()}: ${isBeforeLoan ? 'Before loan started' : isPaid ? 'Paid' : 'Not paid'}`}
            style={{
              width: '14px', height: '14px', borderRadius: '4px', background: bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            {!isBeforeLoan && (isPaid
              ? <Check style={{ width: '9px', height: '9px', color: '#fff', strokeWidth: 3.5 }} />
              : <X style={{ width: '9px', height: '9px', color: '#fff', strokeWidth: 3.5 }} />)}
          </span>
        );
      })}
    </div>
  );
}

function LoansLoader({ onSelect, onQuickPay, fetchTrigger }) {
  const [loans, setLoans] = useState([]);
  const [agents, setAgents] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  // Which figure the single outstanding-balance column shows: the loan's
  // full remaining balance, or just what's due for one collection period
  // (today's round) on its schedule.
  const [outstandingView, setOutstandingView] = useState('total');
  // Quick chip: active loans nobody's paid on in 7+ days (or ever) — the
  // subtler "stalled" case the separate Overdue Accounts card (which only
  // catches loans past their accrual date) doesn't surface on its own.
  const [followUpFilter, setFollowUpFilter] = useState(false);
  // Typeahead dropdown — shows a handful of matches right under the search
  // box as you type (click one to jump straight to that loan), on top of
  // the full list below still narrowing itself. The list below was already
  // a live, per-keystroke filter (no debounce needed, everything's already
  // in memory) — this isn't fixing a "too slow" search, it's giving a
  // faster path to one specific loan without scrolling/paging the list.
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Quick period shortcut — sets fromDate/toDate for you rather than
  // duplicating the date-range filtering logic. 'custom' means the user
  // edited From/To Date directly and the preset no longer describes them.
  const [periodPreset, setPeriodPreset] = useState('all');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const PAGE_SIZE = 20;

  const applyPeriodPreset = (preset) => {
    setPeriodPreset(preset);
    const todayStr = todayLocalDateStr();
    if (preset === 'all') { setFromDate(''); setToDate(''); return; }
    if (preset === 'today') { setFromDate(todayStr); setToDate(todayStr); return; }
    if (preset === 'this_month') {
      const start = new Date();
      start.setDate(1);
      setFromDate(start.toISOString().slice(0, 10));
      setToDate(todayStr);
      return;
    }
    if (preset === 'this_year') {
      const start = new Date(new Date().getFullYear(), 0, 1);
      setFromDate(start.toISOString().slice(0, 10));
      setToDate(todayStr);
      return;
    }
    if (preset.startsWith('last_')) {
      const n = parseInt(preset.split('_')[1], 10);
      const start = new Date();
      start.setMonth(start.getMonth() - n);
      setFromDate(start.toISOString().slice(0, 10));
      setToDate(todayStr);
    }
  };

  // Measured (not hardcoded) so the sticky search bar sits flush under the
  // real .app-header regardless of how tall it renders — that height
  // differs between desktop and the shrunk mobile header, and hardcoding
  // either would either leave a gap or get hidden under the header on the
  // other breakpoint. Re-measures on resize/orientation change.
  const [stickyTop, setStickyTop] = useState(0);
  useEffect(() => {
    const measure = () => {
      const header = document.querySelector('.app-header');
      setStickyTop(header ? header.getBoundingClientRect().height : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/loans'),
      api.get('/users/agents').catch(() => [])
    ])
      .then(([loansData, agentsData]) => {
        setLoans(Array.isArray(loansData) ? loansData : []);
        setAgents(Array.isArray(agentsData) ? agentsData : []);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [fetchTrigger]);

  useEffect(() => { setPage(1); }, [searchTerm, statusFilter, typeFilter, agentFilter, fromDate, toDate, followUpFilter, fetchTrigger]);

  const clearAllFilters = () => {
    setSearchTerm(''); setStatusFilter('all'); setTypeFilter('all');
    setAgentFilter('all'); setFromDate(''); setToDate(''); setPeriodPreset('all'); setFollowUpFilter(false);
  };

  if (loading) return <div className="glass-card" style={{ marginTop: '24px' }}><SkeletonCards count={4} lines={2} /></div>;

  // Tiny "Last Paid" detail for the directory — null/undefined means the
  // loan has never had a payment collected. Colored amber/rose the longer
  // it's been, so a stalled active account is spottable at a glance
  // without opening the full statement (the whole point of a directory
  // view — the Overdue Accounts card above already covers loans past
  // their accrual date, this covers the subtler "still active but nobody's
  // paid in a while" case a due-date check alone won't catch).
  //
  // Declared here (before filteredLoans/followUpCount below, which both
  // call it) rather than further down near the other render helpers —
  // this and urgencyGroupOf/isNeedsFollowUp MUST come before their first
  // use: as `const`, referencing them earlier throws "Cannot access
  // before initialization" (temporal dead zone), not just an undefined
  // value — this exact ordering bug crashed the whole page on load.
  const lastPaidInfo = (loan) => {
    if (!loan.last_payment_date) {
      return { text: 'Never paid', color: loan.status === 'active' ? 'var(--accent-rose)' : 'var(--text-muted)' };
    }
    const days = Math.floor((Date.now() - new Date(loan.last_payment_date).getTime()) / 86400000);
    const text = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago`;
    const color = loan.status !== 'active' ? 'var(--text-muted)' : days >= 14 ? 'var(--accent-rose)' : days >= 7 ? 'var(--accent-amber)' : 'var(--text-muted)';
    return { text, color };
  };

  const isNeedsFollowUp = (loan) => loan.status === 'active' && lastPaidInfo(loan).color !== 'var(--text-muted)';

  // Which section a loan belongs in when the directory is sorted by
  // urgency — lower rank surfaces first, so what needs a human's attention
  // soonest (an approval decision, a stalled collection) is always at the
  // top of the list instead of buried behind filters.
  const urgencyGroupOf = (loan) => {
    if (loan.status === 'pending') return { rank: 0, label: 'Awaiting Approval', icon: '⏳' };
    if (loan.status === 'active') {
      const { color } = lastPaidInfo(loan);
      if (color === 'var(--accent-rose)') return { rank: 1, label: 'Needs Follow-up', icon: '🔴' };
      if (color === 'var(--accent-amber)') return { rank: 2, label: 'Due Soon', icon: '🟡' };
      return { rank: 3, label: 'Active', icon: '🟢' };
    }
    if (loan.status === 'defaulted') return { rank: 4, label: 'Defaulted', icon: '⚠️' };
    if (loan.status === 'fully_paid') return { rank: 5, label: 'Fully Paid', icon: '✅' };
    return { rank: 6, label: 'Other', icon: '⚪' };
  };

  const followUpCount = loans.filter(isNeedsFollowUp).length;

  const filteredLoans = loans.filter(loan => {
    const q = searchTerm.trim().toLowerCase();
    const matchesSearch = !q ||
      loan.borrower_name.toLowerCase().includes(q) ||
      loan.borrower_phone.includes(q) ||
      (loan.nic_number && loan.nic_number.toLowerCase().includes(q)) ||
      (loan.reference_number && loan.reference_number.toLowerCase().includes(q));
    const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
    const matchesType = typeFilter === 'all' || loan.interest_type === typeFilter;
    const matchesAgent = agentFilter === 'all' || String(loan.assigned_agent_id) === String(agentFilter);
    const matchesFollowUp = !followUpFilter || isNeedsFollowUp(loan);
    let matchesDate = true;
    if (fromDate) matchesDate = matchesDate && new Date(loan.created_at) >= new Date(fromDate);
    if (toDate) { const e = new Date(toDate); e.setHours(23,59,59,999); matchesDate = matchesDate && new Date(loan.created_at) <= e; }
    return matchesSearch && matchesStatus && matchesType && matchesAgent && matchesFollowUp && matchesDate;
  })
    // Sorted by urgency (Awaiting Approval -> Needs Follow-up -> Due Soon ->
    // Active -> Defaulted -> Fully Paid -> Other) rather than left in the
    // API's plain created-date order — a stable sort, so loans within the
    // same urgency group keep their original relative order. This is what
    // lets the directory read as "what needs attention first" without
    // requiring a filter to be applied.
    .sort((a, b) => urgencyGroupOf(a).rank - urgencyGroupOf(b).rank);

  // Typeahead suggestions — searches the FULL loan list (not just the
  // currently status/type/agent-filtered set), since the whole point is a
  // fast path to one loan regardless of what filters happen to be active.
  // Capped at 8 so it stays a quick-scan dropdown, not another full list.
  const searchSuggestions = searchTerm.trim()
    ? loans.filter(loan => {
        const q = searchTerm.trim().toLowerCase();
        return loan.borrower_name.toLowerCase().includes(q) ||
          loan.borrower_phone.includes(q) ||
          (loan.nic_number && loan.nic_number.toLowerCase().includes(q)) ||
          (loan.reference_number && loan.reference_number.toLowerCase().includes(q));
      }).slice(0, 8)
    : [];

  const hasActiveFilters = searchTerm || statusFilter !== 'all' || typeFilter !== 'all' || agentFilter !== 'all' || fromDate || toDate || followUpFilter;
  const totalPages = Math.max(1, Math.ceil(filteredLoans.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedLoans = filteredLoans.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Precomputes which rows start a new urgency section on THIS page, so
  // both the desktop table and mobile card list can insert the same
  // section header without duplicating the "did the group just change"
  // bookkeeping in two separate render loops.
  let prevGroupRank = null;
  const pagedLoansWithGroups = pagedLoans.map(loan => {
    const group = urgencyGroupOf(loan);
    const showGroupHeader = group.rank !== prevGroupRank;
    prevGroupRank = group.rank;
    return { loan, group, showGroupHeader };
  });

  // The loan's full remaining balance — principal and interest combined
  // into one figure. Splitting these into two columns only made sense as
  // an accounting detail; a field agent or admin scanning the directory
  // just needs to know what's still owed.
  const totalOutstandingOf = (loan) => (parseFloat(loan.principal_outstanding) || 0) + (parseFloat(loan.interest_balance) || 0);

  // What one collection round on this loan's own schedule is worth —
  // the flat daily installment for flat-installment loans, or the
  // period's interest amount (daily/weekly/monthly) for every other loan
  // type. Same formula the Record Payment sheet uses for "Due", so this
  // matches what an agent would actually be collecting today, capped at
  // whatever's actually still left on the loan.
  const periodDueOf = (loan) => {
    const remaining = totalOutstandingOf(loan);
    // Flat-installment loans: use flatInstallmentDueToday, which already
    // accounts for whatever's been collected today (or since the last
    // collection) — not just the flat daily rate, which stayed nonzero
    // even seconds after that exact amount had just been paid in full.
    if (loan.is_flat_installment) return flatInstallmentDueToday(loan);
    const monthlyInterest = (parseFloat(loan.principal_amount) || 0) * ((parseFloat(loan.interest_rate) || 0) / 100);
    const period = loan.interest_type === 'daily' ? monthlyInterest / 30 : loan.interest_type === 'weekly' ? monthlyInterest / 4 : monthlyInterest;
    return Math.min(period, remaining);
  };

  const handleExportCsv = () => {
    downloadCsv(
      `loans-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Date Given', 'Borrower', 'Phone', 'NIC', 'Principal', 'Interest Type', 'Rate %', 'Total Collected', 'Total Outstanding', "Today's Due", 'Last Paid', 'Agent', 'Status'],
      filteredLoans.map(loan => [
        new Date(loan.created_at).toLocaleDateString(), loan.borrower_name, loan.borrower_phone,
        loan.nic_number || '', parseFloat(loan.principal_amount).toFixed(2), loan.interest_type,
        loan.interest_rate, (parseFloat(loan.total_collected) || 0).toFixed(2), totalOutstandingOf(loan).toFixed(2),
        periodDueOf(loan).toFixed(2), loan.last_payment_date ? new Date(loan.last_payment_date).toLocaleDateString() : 'Never',
        loan.agent_name || 'Self-Collect', loan.status
      ])
    );
  };

  const totalPrincipal = filteredLoans.reduce((s, l) => s + (parseFloat(l.principal_amount) || 0), 0);
  const totalOutstanding = filteredLoans.reduce((s, l) => s + totalOutstandingOf(l), 0);
  const totalCollected = filteredLoans.reduce((s, l) => s + (parseFloat(l.total_collected) || 0), 0);
  const totalDueToday = filteredLoans.filter(l => l.status === 'active').reduce((s, l) => s + periodDueOf(l), 0);
  const activeCount = filteredLoans.filter(l => l.status === 'active').length;
  const paidCount = filteredLoans.filter(l => l.status === 'fully_paid').length;
  const typeColor = { daily: 'var(--accent-blue)', weekly: 'var(--accent-amber)', monthly: 'var(--accent-emerald)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '8px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '26px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <ClipboardList style={{ color: 'var(--accent-blue)', width: '28px', height: '28px' }} />
            Loan Directory
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
            {hasActiveFilters
              ? <><strong style={{ color: 'var(--accent-blue)' }}>{filteredLoans.length}</strong> of {loans.length} loans match your filters</>
              : <><strong style={{ color: 'var(--text-primary)' }}>{loans.length}</strong> total loan accounts</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {hasActiveFilters && (
            <button type="button" className="glass-btn glass-btn-rose" style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '700' }} onClick={clearAllFilters}>
              <RefreshCcw className="icon" /> Clear Filters
            </button>
          )}
          <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 16px', fontSize: '12px' }} onClick={handleExportCsv} disabled={filteredLoans.length === 0}>
            <Download className="icon" /> Export CSV
          </button>
        </div>
      </div>

      {/* Outstanding column toggle — switches the table/card "Outstanding"
          figure between the loan's full remaining balance and just what's
          due for today's collection round. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Show:</span>
        <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '3px' }}>
          {[
            { key: 'total', label: 'Total Outstanding' },
            { key: 'today', label: "Today's Outstanding" }
          ].map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setOutstandingView(opt.key)}
              style={{
                padding: '7px 14px', fontSize: '12px', fontWeight: '700', borderRadius: '7px', border: 'none', cursor: 'pointer',
                background: outstandingView === opt.key ? 'var(--accent-blue)' : 'transparent',
                color: outstandingView === opt.key ? '#ffffff' : 'var(--text-secondary)',
                transition: 'background 0.15s'
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="kpi-summary-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        {[
          { label: 'Total Disbursed', val: `LKR ${Math.round(totalPrincipal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: 'var(--accent-blue)', icon: '💰' },
          { label: 'Total Collected', val: `LKR ${Math.round(totalCollected).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: 'var(--accent-emerald)', icon: '🧾' },
          { label: 'Total Outstanding', val: `LKR ${Math.round(totalOutstanding).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: 'var(--accent-rose)', icon: '📊' },
          { label: "Today's Due (Active)", val: `LKR ${Math.round(totalDueToday).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: 'var(--accent-amber)', icon: '📅' },
          { label: 'Active / Unpaid', val: activeCount, color: 'var(--accent-emerald)', icon: '🟢' },
          { label: 'Fully Paid', val: paidCount, color: 'var(--text-secondary)', icon: '✅' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '14px', padding: '14px 16px' }}>
            <span style={{ fontSize: '18px' }}>{k.icon}</span>
            <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginTop: '4px' }}>{k.label}</span>
            <span style={{ fontSize: '18px', fontWeight: '800', color: k.color, display: 'block' }}>{k.val}</span>
          </div>
        ))}
      </div>

      {/* Filter Panel */}
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '16px', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Just the search bar sticks, not the whole filter drawer below it
            — a full sticky panel (period/type/agent dropdowns and all)
            would eat too much screen on a long scroll; the search box is
            the one control worth keeping reachable without scrolling back
            up, especially one-handed on mobile. */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', position: 'sticky', top: stickyTop, zIndex: 40, background: 'var(--bg-secondary)', paddingTop: '2px', paddingBottom: '2px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: '14px', height: '14px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              type="text"
              className="glass-input"
              placeholder="Search name, phone, NIC, code…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              style={{ paddingLeft: '32px', fontSize: '13px', width: '100%' }}
            />
            {isSearchFocused && searchSuggestions.length > 0 && (
              <div
                style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '10px',
                  boxShadow: 'var(--shadow-md)', overflow: 'hidden', maxHeight: '320px', overflowY: 'auto',
                }}
              >
                {searchSuggestions.map(loan => (
                  <button
                    key={loan.id}
                    type="button"
                    // onMouseDown (not onClick) fires BEFORE the input's onBlur
                    // closes this dropdown — onClick alone would never get a
                    // chance to run.
                    onMouseDown={(e) => { e.preventDefault(); onSelect(loan.id); }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
                      padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--border-light)',
                      background: 'transparent', cursor: 'pointer', textAlign: 'left', font: 'inherit',
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: '13px' }}>{loan.borrower_name}</strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {loan.borrower_phone}{loan.reference_number ? ` · ${loan.reference_number}` : ''}
                      </span>
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: totalOutstandingOf(loan) > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)', whiteSpace: 'nowrap', marginLeft: '10px' }}>
                      {totalOutstandingOf(loan) > 0 ? `LKR ${totalOutstandingOf(loan).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Settled'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`glass-btn ${hasActiveFilters ? 'glass-btn-blue' : 'glass-btn-secondary'} mobile-only`}
            style={{ padding: '8px 14px', fontSize: '12px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setShowMobileFilters(!showMobileFilters)}
          >
            <Filter className="icon" style={{ width: '14px', height: '14px' }} />
            Filters {hasActiveFilters && '•'}
          </button>
        </div>

        {/* Collapsible Filters Drawer for Mobile, always visible on Desktop */}
        <div className={`${!showMobileFilters ? 'mobile-hidden' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '14px', alignItems: 'flex-end' }}>
            <div>
              <label htmlFor="f-period-8036" style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>⏱️ Period</label>
              <select id="f-period-8036" className="glass-input" value={periodPreset} onChange={e => applyPeriodPreset(e.target.value)} style={{ fontSize: '13px', width: '100%' }}>
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="this_month">This Month</option>
                <option value="this_year">This Year</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={`last_${n}`}>Last {n} Month{n > 1 ? 's' : ''}</option>
                ))}
                <option value="custom">Custom Range</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-from-date-8049" style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>📅 From Date</label>
              <input id="f-from-date-8049" type="date" className="glass-input" value={fromDate} onChange={e => { setFromDate(e.target.value); setPeriodPreset('custom'); }} style={{ fontSize: '13px', width: '100%' }} />
            </div>
            <div>
              <label htmlFor="f-to-date-8053" style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>📅 To Date</label>
              <input id="f-to-date-8053" type="date" className="glass-input" value={toDate} onChange={e => { setToDate(e.target.value); setPeriodPreset('custom'); }} style={{ fontSize: '13px', width: '100%' }} />
            </div>
            <div>
              <label htmlFor="f-collection-type-8057" style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>🔄 Collection Type</label>
              <select id="f-collection-type-8057" className="glass-input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ fontSize: '13px', width: '100%' }}>
                <option value="all">All Types</option>
                <option value="daily">Daily Collection</option>
                <option value="weekly">Weekly Collection</option>
                <option value="monthly">Monthly Collection</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-assigned-agent-8066" style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>👤 Assigned Agent</label>
              <select id="f-assigned-agent-8066" className="glass-input" value={agentFilter} onChange={e => setAgentFilter(e.target.value)} style={{ fontSize: '13px', width: '100%' }}>
                <option value="all">All Agents</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status:</span>
            {[
              { val: 'all', label: `All (${loans.length})`, activeClass: 'glass-btn-blue' },
              { val: 'pending', label: `Pending Approval (${loans.filter(l => l.status === 'pending').length})`, activeClass: 'glass-btn-amber' },
              { val: 'active', label: `Active (${loans.filter(l => l.status === 'active').length})`, activeClass: 'glass-btn-emerald' },
              { val: 'fully_paid', label: `Paid (${loans.filter(l => l.status === 'fully_paid').length})`, activeClass: 'glass-btn-secondary' },
              { val: 'defaulted', label: `Defaulted (${loans.filter(l => l.status === 'defaulted').length})`, activeClass: 'glass-btn-rose' },
              { val: 'rejected', label: `Rejected (${loans.filter(l => l.status === 'rejected').length})`, activeClass: 'glass-btn-secondary' },
            ].map(f => (
              <button key={f.val} type="button"
                className={`glass-btn ${statusFilter === f.val ? f.activeClass : 'glass-btn-secondary'}`}
                style={{ padding: '5px 14px', fontSize: '12px', fontWeight: statusFilter === f.val ? '700' : '500' }}
                onClick={() => setStatusFilter(f.val)}>
                {f.label}
              </button>
            ))}
            {/* Quick chip, separate from the status filters above — cuts
                across status (only ever matches active loans) to answer
                "who has nobody collected from in a while", which a status
                filter alone can't express. */}
            <span style={{ width: '1px', height: '18px', background: 'var(--border-light)', margin: '0 2px' }} />
            <button type="button"
              className={`glass-btn ${followUpFilter ? 'glass-btn-rose' : 'glass-btn-secondary'}`}
              style={{ padding: '5px 14px', fontSize: '12px', fontWeight: followUpFilter ? '700' : '500' }}
              onClick={() => setFollowUpFilter(f => !f)}>
              🔴 Needs Follow-up ({followUpCount})
            </button>
          </div>
        </div>
        {hasActiveFilters && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active:</span>
            {searchTerm && <span style={{ background: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>"{searchTerm}"</span>}
            {statusFilter !== 'all' && <span style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--accent-emerald)', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>{statusFilter}</span>}
            {followUpFilter && <span style={{ background: 'rgba(244,63,94,0.15)', color: 'var(--accent-rose)', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>Needs Follow-up</span>}
            {typeFilter !== 'all' && <span style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--accent-amber)', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>{typeFilter}</span>}
            {agentFilter !== 'all' && <span style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>{agents.find(a => String(a.id) === agentFilter)?.name || 'Agent'}</span>}
            {fromDate && <span style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>From {fromDate}</span>}
            {toDate && <span style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>To {toDate}</span>}
          </div>
        )}
      </div>

      {filteredLoans.length === 0 ? (
        <div className="glass-card">
          <div className="empty-state">
            <div className="empty-state-icon"><Search style={{ width: '28px', height: '28px' }} /></div>
            <h4 className="empty-state-title">No Matching Loans Found</h4>
            <p className="empty-state-text">{hasActiveFilters ? 'No loans match your current filters. Try clearing or adjusting them.' : 'No loan accounts exist yet.'}</p>
            {hasActiveFilters && <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '8px 18px', fontSize: '13px' }} onClick={clearAllFilters}><RefreshCcw className="icon" /> Clear All Filters</button>}
          </div>
        </div>
      ) : (
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="desktop-only" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '2px solid var(--border-light)' }}>
                  {['Date Given', 'Borrower', 'Amount', 'Type', 'Rate', outstandingView === 'total' ? 'Total Outstanding' : "Today's Due", 'Agent', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedLoansWithGroups.map(({ loan, group, showGroupHeader }, i) => {
                  const isActive = loan.status === 'active';
                  const isPaid = loan.status === 'fully_paid';
                  const isPending = loan.status === 'pending';
                  const isRejected = loan.status === 'rejected';
                  return (
                    <React.Fragment key={loan.id}>
                    {showGroupHeader && (
                      <tr>
                        <td colSpan={9} style={{ padding: '10px 14px', fontSize: '11px', fontWeight: '800', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--bg-tertiary)', borderTop: i > 0 ? '2px solid var(--border-light)' : 'none' }}>
                          {group.icon} {group.label}
                        </td>
                      </tr>
                    )}
                    <tr
                      style={{ borderBottom: '1px solid var(--border-light)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)', cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.06)'}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'}
                      onClick={() => onSelect(loan.id)}>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: '12px' }}>{new Date(loan.created_at).toLocaleDateString()}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <strong style={{ display: 'block', fontSize: '13px' }}>{loan.borrower_name}</strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                          <span><Phone className="icon" style={{ width: '12px', height: '12px' }} /> {loan.borrower_phone}</span>
                          <span className="quick-contact-actions" onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: '4px' }}>
                            <a href={`tel:${loan.borrower_phone}`} className="quick-contact-btn phone" title="Call Customer" style={{ color: 'var(--accent-blue)' }}>
                              <Phone style={{ width: '11px', height: '11px' }} />
                            </a>
                            <a href={`https://wa.me/${(loan.borrower_phone || '').replace(/[^0-9]/g, '').startsWith('0') ? '94' + (loan.borrower_phone || '').replace(/[^0-9]/g, '').slice(1) : (loan.borrower_phone || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="quick-contact-btn whatsapp" title="Chat on WhatsApp" style={{ color: '#25D366' }}>
                              <MessageSquare style={{ width: '11px', height: '11px' }} />
                            </a>
                          </span>
                        </div>
                        {loan.nic_number && <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}><IdCard className="icon" /> {loan.nic_number}</span>}
                        {loan.reference_number && <span style={{ fontSize: '10px', background: 'rgba(59,130,246,0.12)', color: 'var(--accent-blue)', padding: '1px 6px', borderRadius: '4px', display: 'inline-block', marginTop: '2px' }}>{loan.reference_number}</span>}
                        <span style={{ fontSize: '10px', color: lastPaidInfo(loan).color, display: 'block', marginTop: '2px', fontWeight: lastPaidInfo(loan).color !== 'var(--text-muted)' ? '700' : '400' }}>
                          <CreditCard className="icon" style={{ width: '10px', height: '10px' }} /> Last paid: {lastPaidInfo(loan).text}
                        </span>
                        {loan.last5Days && <div style={{ marginTop: '4px' }}><Last5DaysStreak last5Days={loan.last5Days} /></div>}
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: '700', whiteSpace: 'nowrap' }}>LKR {parseFloat(loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ background: (typeColor[loan.interest_type] || '#666') + '22', color: typeColor[loan.interest_type] || 'var(--text-secondary)', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
                          {loan.interest_type}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{loan.interest_rate}%</td>
                      {/* Single combined outstanding figure — either the
                          loan's full remaining balance or today's period
                          due, per the Total/Today's toggle above. Splitting
                          principal vs interest into two columns was just an
                          internal accounting detail that confused borrowers
                          and agents reading the directory. */}
                      <td style={{ padding: '12px 14px', fontWeight: '700', color: totalOutstandingOf(loan) > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)', whiteSpace: 'nowrap' }}>
                        {totalOutstandingOf(loan) <= 0
                          ? 'Settled'
                          : `LKR ${(outstandingView === 'total' ? totalOutstandingOf(loan) : periodDueOf(loan)).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: 'var(--text-secondary)' }}>{loan.agent_name || <em style={{ color: 'var(--text-muted)' }}>Office</em>}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <span className={`status-pill ${isActive ? 'status-pill-active' : isPaid ? 'status-pill-paid' : isPending ? 'status-pill-pending' : isRejected ? 'status-pill-rejected' : 'status-pill-defaulted'}`}>
                          <span className="status-pill-dot" />{isActive ? 'Active' : isPaid ? 'Paid' : isPending ? 'Pending Approval' : isRejected ? 'Rejected' : loan.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {isActive && (
                            <button className="glass-btn glass-btn-emerald" style={{ padding: '5px 12px', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }} onClick={e => { e.stopPropagation(); onQuickPay(loan.id); }} title="Jump straight to Record Payment for this loan">
                              <CreditCard className="icon" style={{ width: '11px', height: '11px' }} /> Pay
                            </button>
                          )}
                          <button className="glass-btn glass-btn-secondary" style={{ padding: '5px 12px', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }} onClick={e => { e.stopPropagation(); onSelect(loan.id); }}>View &rarr;</button>
                        </div>
                      </td>
                    </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mobile-only" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {pagedLoansWithGroups.map(({ loan, group, showGroupHeader }) => {
              const isActive = loan.status === 'active';
              const isPaid = loan.status === 'fully_paid';
              const isPending = loan.status === 'pending';
              const isRejected = loan.status === 'rejected';
              const bc = isActive ? 'var(--accent-amber)' : isPaid ? 'var(--accent-emerald)' : isPending ? 'var(--accent-blue)' : isRejected ? 'var(--text-muted)' : 'var(--accent-rose)';
              return (
                <React.Fragment key={loan.id}>
                {showGroupHeader && (
                  <div style={{ fontSize: '11px', fontWeight: '800', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 4px 2px' }}>
                    {group.icon} {group.label}
                  </div>
                )}
                <div onClick={() => onSelect(loan.id)} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '14px', padding: '14px 16px', cursor: 'pointer', borderLeft: `4px solid ${bc}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <div>
                      <strong style={{ fontSize: '15px', display: 'block' }}>{loan.borrower_name}</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><Phone className="icon" /> {loan.borrower_phone}</span>
                        <span className="quick-contact-actions" onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: '4px' }}>
                          <a href={`tel:${loan.borrower_phone}`} className="quick-contact-btn phone" title="Call" style={{ color: 'var(--accent-blue)' }}>
                            <Phone style={{ width: '12px', height: '12px' }} />
                          </a>
                          <a href={`https://wa.me/${(loan.borrower_phone || '').replace(/[^0-9]/g, '').startsWith('0') ? '94' + (loan.borrower_phone || '').replace(/[^0-9]/g, '').slice(1) : (loan.borrower_phone || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="quick-contact-btn whatsapp" title="WhatsApp" style={{ color: '#25D366' }}>
                            <MessageSquare style={{ width: '12px', height: '12px' }} />
                          </a>
                        </span>
                      </div>
                      {loan.nic_number && <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}><IdCard className="icon" /> {loan.nic_number}</span>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      <span className={`status-pill ${isActive ? 'status-pill-active' : isPaid ? 'status-pill-paid' : isPending ? 'status-pill-pending' : isRejected ? 'status-pill-rejected' : 'status-pill-defaulted'}`}><span className="status-pill-dot" />{isActive ? 'Active' : isPaid ? 'Paid' : isPending ? 'Pending' : isRejected ? 'Rejected' : loan.status}</span>
                      <span style={{ background: (typeColor[loan.interest_type] || '#666') + '22', color: typeColor[loan.interest_type], padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: '700', textTransform: 'capitalize' }}>{loan.interest_type}</span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {(loan.is_flat_installment
                      ? [
                          ['Principal', `LKR ${parseFloat(loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, null],
                          ['Daily Installment', `LKR ${parseFloat(loan.daily_installment_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, null]
                        ]
                      : [
                          ['Principal', `LKR ${parseFloat(loan.principal_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, null],
                          ['Rate', `${loan.interest_rate}%`, null]
                        ]
                    ).concat([
                      [
                        outstandingView === 'total' ? 'Total Outstanding' : "Today's Due",
                        totalOutstandingOf(loan) <= 0 ? 'Settled' : `LKR ${(outstandingView === 'total' ? totalOutstandingOf(loan) : periodDueOf(loan)).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                        totalOutstandingOf(loan) > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'
                      ]
                    ]).map(([lbl, val, col]) => (
                      <div key={lbl} style={{ background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px' }}>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase' }}>{lbl}</span>
                        <span style={{ fontWeight: '700', fontSize: '12px', color: col || 'var(--text-primary)' }}>{val}</span>
                      </div>
                    ))}
                  </div>
                  {loan.last5Days && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Last 5 Days:</span>
                      <Last5DaysStreak last5Days={loan.last5Days} />
                    </div>
                  )}
                  {isActive && (
                    <button
                      type="button"
                      className="glass-btn glass-btn-emerald"
                      style={{ width: '100%', marginTop: '10px', padding: '10px', fontSize: '13px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      onClick={e => { e.stopPropagation(); onQuickPay(loan.id); }}
                    >
                      <CreditCard className="icon" style={{ width: '14px', height: '14px' }} /> Record Payment
                    </button>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-light)', fontSize: '11px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{loan.agent_name || 'Office'} · {new Date(loan.created_at).toLocaleDateString()}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ color: lastPaidInfo(loan).color, fontWeight: lastPaidInfo(loan).color !== 'var(--text-muted)' ? '700' : '400' }}>Paid: {lastPaidInfo(loan).text}</span>
                      <ChevronRight style={{ width: '13px', height: '13px', color: 'var(--text-muted)' }} />
                    </span>
                  </div>
                </div>
                </React.Fragment>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', padding: '16px', borderTop: '1px solid var(--border-light)', flexWrap: 'wrap' }}>
              <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '7px 16px', fontSize: '12px' }} disabled={currentPage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>← Prev</button>
              <div style={{ display: 'flex', gap: '4px' }}>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map(p => (
                  <button key={p} type="button" onClick={() => setPage(p)} style={{ width: '32px', height: '32px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', border: 'none', cursor: 'pointer', background: currentPage === p ? 'var(--accent-blue)' : 'var(--bg-tertiary)', color: currentPage === p ? '#fff' : 'var(--text-secondary)', transition: 'all 0.2s' }}>{p}</button>
                ))}
              </div>
              <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '7px 16px', fontSize: '12px' }} disabled={currentPage === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next →</button>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{filteredLoans.length} total</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// Full, paginated audit trail with multi-criteria filtering
// Review queue for public /apply form submissions (see BorrowerIntakeForm.jsx
// and /api/borrower-intakes) — an agent shares the /apply link (WhatsApp,
// printed flyer, whatever), anyone fills it in, and it lands here for
// staff to review before "Create Loan from This" pre-fills the real Give
// Loan wizard with it.
function BorrowerIntakesLoader({ onConvert, onCountChange, showToast }) {
  const [intakes, setIntakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [copied, setCopied] = useState(false);

  const applyUrl = typeof window !== 'undefined' ? `${window.location.origin}/apply` : '/apply';

  const load = () => {
    setLoading(true);
    api.get(`/borrower-intakes?status=${statusFilter}`)
      .then(res => {
        const list = Array.isArray(res) ? res : [];
        setIntakes(list);
        if (statusFilter === 'pending' && onCountChange) onCountChange(list.length);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter]);

  const handleDismiss = async (intake) => {
    try {
      await api.patch(`/borrower-intakes/${intake.id}`, { status: 'dismissed' });
      showToast(`Dismissed ${intake.borrower_name}'s application.`);
      load();
    } catch (err) {
      showToast(err.message || 'Could not dismiss this application.', 'error');
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(applyUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Shareable link — the whole feature is useless if staff don't know
          where to find this. */}
      <div className="glass-card" style={{ background: 'var(--accent-blue-light)', border: '1px solid rgba(37,84,232,0.2)' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ClipboardCheck className="icon" style={{ color: 'var(--accent-blue)' }} /> Share Application Link
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Send this link via WhatsApp (or print it) so a borrower — or a literate family member on their behalf — can submit their own details ahead of your visit, in English or Tamil.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input readOnly value={applyUrl} className="glass-input" style={{ flex: 1, minWidth: '220px', fontSize: '13px', fontFamily: 'monospace' }} onClick={e => e.target.select()} />
          <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={handleCopyLink}>
            {copied ? <><CircleCheck className="icon" /> Copied</> : 'Copy Link'}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`Please fill in this loan application form: ${applyUrl}`)}`}
            target="_blank" rel="noopener noreferrer"
            className="glass-btn btn-whatsapp"
            style={{ padding: '8px 16px', fontSize: '13px', backgroundColor: '#25D366', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <MessageSquare className="icon" style={{ width: '14px', height: '14px' }} /> Share via WhatsApp
          </a>
        </div>
      </div>

      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ClipboardCheck className="icon" style={{ color: 'var(--accent-blue)' }} /> Applications
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Submissions from the public application form, awaiting review.</span>
          </div>
          <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '3px' }}>
            {['pending', 'converted', 'dismissed', 'all'].map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '6px 12px', fontSize: '12px', fontWeight: '700', textTransform: 'capitalize', borderRadius: '7px', border: 'none', cursor: 'pointer',
                  background: statusFilter === s ? 'var(--accent-blue)' : 'transparent',
                  color: statusFilter === s ? '#fff' : 'var(--text-secondary)'
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <SkeletonCards count={3} lines={2} />
        ) : intakes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><ClipboardCheck style={{ width: '28px', height: '28px' }} /></div>
            <h4 className="empty-state-title">No {statusFilter === 'all' ? '' : statusFilter} applications</h4>
            <p className="empty-state-text">
              {statusFilter === 'pending' ? 'Share the link above to start receiving applications.' : 'Nothing here yet.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {intakes.map(intake => (
              <div key={intake.id} style={{ border: '1px solid var(--border-light)', borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <strong style={{ fontSize: '16px' }}>{intake.borrower_name}</strong>
                    <span className={`badge ${intake.status === 'pending' ? 'badge-pending' : intake.status === 'converted' ? 'badge-active' : 'badge-defaulted'}`} style={{ marginLeft: '8px', textTransform: 'capitalize' }}>{intake.status}</span>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      <Phone className="icon" style={{ width: '12px', height: '12px' }} /> {intake.borrower_phone}
                      {' · '}Submitted {new Date(intake.created_at).toLocaleString()}
                      {' · '}{intake.submitted_language === 'ta' ? 'Filled in Tamil' : 'Filled in English'}
                    </div>
                  </div>
                  {intake.status === 'pending' && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => handleDismiss(intake)}>Dismiss</button>
                      <button type="button" className="glass-btn glass-btn-emerald" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => onConvert(intake)}>Create Loan from This</button>
                    </div>
                  )}
                </div>
                <div className="responsive-grid-2-col" style={{ gap: '8px', fontSize: '13px' }}>
                  {intake.borrower_address && <div><strong style={{ color: 'var(--text-secondary)' }}>Address:</strong> {intake.borrower_address}</div>}
                  {intake.nic_number && <div><strong style={{ color: 'var(--text-secondary)' }}>NIC:</strong> {intake.nic_number}</div>}
                  {intake.date_of_birth && <div><strong style={{ color: 'var(--text-secondary)' }}>DOB:</strong> {new Date(intake.date_of_birth).toLocaleDateString()}</div>}
                  {intake.loan_purpose && <div><strong style={{ color: 'var(--text-secondary)' }}>Purpose:</strong> {intake.loan_purpose}</div>}
                  {intake.dependents_count !== null && <div><strong style={{ color: 'var(--text-secondary)' }}>Dependents:</strong> {intake.dependents_count}</div>}
                  {intake.monthly_income !== null && <div><strong style={{ color: 'var(--text-secondary)' }}>Monthly Income:</strong> LKR {parseFloat(intake.monthly_income).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
                  {intake.spouse_name && <div><strong style={{ color: 'var(--text-secondary)' }}>Spouse:</strong> {intake.spouse_name}{intake.spouse_occupation ? ` (${intake.spouse_occupation})` : ''}</div>}
                </div>
                {(intake.nic_photo_count > 0 || intake.photo_proof_count > 0 || intake.guarantors?.length > 0) && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                    {intake.nic_photo_count > 0 && <span style={{ background: 'rgba(37,84,232,0.1)', color: 'var(--accent-blue)', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }}><Camera className="icon" style={{ width: '11px', height: '11px' }} /> NIC photo ×{intake.nic_photo_count}</span>}
                    {intake.photo_proof_count > 0 && <span style={{ background: 'rgba(37,84,232,0.1)', color: 'var(--accent-blue)', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }}><Camera className="icon" style={{ width: '11px', height: '11px' }} /> Photo proof ×{intake.photo_proof_count}</span>}
                    {intake.guarantors?.length > 0 && (
                      <span style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--accent-emerald)', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }}>
                        <ShieldCheck className="icon" style={{ width: '11px', height: '11px' }} /> {intake.guarantors.length} guarantor{intake.guarantors.length > 1 ? 's' : ''} submitted
                      </span>
                    )}
                  </div>
                )}
                {intake.notes && <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '10px', fontStyle: 'italic', borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>"{intake.notes}"</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AuditLogLoader() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [actionType, setActionType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // The typed value updates instantly (so the input never feels laggy);
  // the DEBOUNCED value is what actually triggers a request — this was
  // previously firing a fresh /api/audit-logs call on every single
  // keystroke, which both hammers the server and makes fast typing feel
  // janky as each half-typed query briefly flashes its own results.
  const debouncedSearch = useDebouncedValue(search, 350);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (actionType) params.set('actionType', actionType);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);

    api.get(`/audit-logs?${params.toString()}`)
      .then(res => setData(res))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, actionType, fromDate, toDate]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, actionType, fromDate, toDate]);

  const clearFilters = () => {
    setSearch('');
    setActionType('');
    setFromDate('');
    setToDate('');
  };

  const hasActiveFilters = search || actionType || fromDate || toDate;

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ScrollText className="icon" style={{ color: 'var(--accent-blue)' }} /> Audit Log
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {data ? `Showing page ${data.page} of ${data.totalPages} (${data.total} total log entries)` : 'System activity trail'}
          </span>
        </div>

        {hasActiveFilters && (
          <button type="button" className="glass-btn glass-btn-rose" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={clearFilters}>
            <RefreshCcw className="icon" /> Reset Filters
          </button>
        )}
      </div>

      {/* Filter Toolbar */}
      <div style={{ padding: '14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '10px', marginBottom: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="f-search-description-8549" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Search Description</label>
          <input id="f-search-description-8549"
            type="text"
            className="glass-input"
            placeholder="Search description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '7px 10px', fontSize: '13px' }}
          />
        </div>
        <div>
          <label htmlFor="f-from-date-8560" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>From Date</label>
          <input id="f-from-date-8560"
            type="date"
            className="glass-input"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            style={{ padding: '7px 10px', fontSize: '13px' }}
          />
        </div>
        <div>
          <label htmlFor="f-to-date-8570" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>To Date</label>
          <input id="f-to-date-8570"
            type="date"
            className="glass-input"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            style={{ padding: '7px 10px', fontSize: '13px' }}
          />
        </div>
        <div>
          <label htmlFor="f-action-type-8580" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Action Type</label>
          <select id="f-action-type-8580" className="glass-input" style={{ padding: '7px 10px', fontSize: '13px' }} value={actionType} onChange={e => setActionType(e.target.value)}>
            <option value="">All Action Types</option>
            {(data?.actionTypes || []).map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && !data ? (
        <SkeletonCards count={5} lines={2} />
      ) : !data || data.data.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Search style={{ width: '28px', height: '28px' }} /></div>
          <h4 className="empty-state-title">No Audit Log Entries Found</h4>
          <p className="empty-state-text">No audit actions match the current filter selection.</p>
        </div>
      ) : (
        <>
          <div className="desktop-only" style={{ overflowX: 'auto' }}>
            <table className="glass-table">
              <thead>
                <tr>
                  <th>Date/Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map(log => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString()}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{log.actor_name || 'System'}{log.actor_role ? ` (${log.actor_role})` : ''}</td>
                    <td><span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{log.action_type}</span></td>
                    <td style={{ fontSize: '13px' }}>{log.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mobile-only mobile-card-list">
            {data.data.map(log => (
              <div key={log.id} className="mobile-row-card">
                <div className="mobile-row-card-header">
                  <span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{log.action_type}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(log.created_at).toLocaleString()}</span>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{log.actor_name || 'System'}{log.actor_role ? ` (${log.actor_role})` : ''}</span>
                <p style={{ fontSize: '13px', margin: '4px 0 0', color: 'var(--text-primary)' }}>{log.description}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} disabled={page === 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>
              ← Prev
            </button>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Page {data.page} of {data.totalPages} ({data.total} entries)</span>
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} disabled={page === data.totalPages || loading} onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Status pill for an sms_logs row — 'sent' (really left the server via
// Text.lk), 'mocked' (Text.lk isn't configured for this org, nothing was
// sent), or 'failed' (Text.lk rejected it / the request errored).
function SmsStatusBadge({ status }) {
  const styles = {
    sent: { background: 'var(--accent-emerald-light, #d1fae5)', color: 'var(--accent-emerald)' },
    mocked: { background: '#fef3c7', color: 'var(--accent-gold)' },
    failed: { background: '#fee2e2', color: 'var(--accent-rose)' }
  };
  const label = { sent: 'Sent', mocked: 'Mocked (not configured)', failed: 'Failed' };
  return (
    <span className="badge" style={{ ...(styles[status] || styles.mocked), fontWeight: '700' }}>
      {label[status] || status}
    </span>
  );
}

// Full, paginated log of every SMS the app has attempted to send (OTP,
// loan/payment/reminder alerts) with its real delivery status — built so a
// misconfigured Text.lk account (silently falling back to a console-only
// mock) is visible here instead of only discoverable after a user reports
// a missing OTP, which is exactly what happened to Sabesh Capital.
function SmsLogLoader() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (status) params.set('status', status);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);

    api.get(`/sms-logs?${params.toString()}`)
      .then(res => setData(res))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, status, fromDate, toDate]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, fromDate, toDate]);

  const clearFilters = () => {
    setSearch('');
    setStatus('');
    setFromDate('');
    setToDate('');
  };

  const hasActiveFilters = search || status || fromDate || toDate;

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Smartphone className="icon" style={{ color: 'var(--accent-blue)' }} /> SMS Delivery Log
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {data ? `Showing page ${data.page} of ${data.totalPages} (${data.total} total messages)` : 'Every OTP and alert this app has tried to send'}
          </span>
        </div>

        {hasActiveFilters && (
          <button type="button" className="glass-btn glass-btn-rose" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={clearFilters}>
            <RefreshCcw className="icon" /> Reset Filters
          </button>
        )}
      </div>

      {/* The whole point of this screen: surface a misconfigured SMS
          provider (or a run of real failures) without anyone having to
          come ask why an OTP never arrived. */}
      {data?.failedOrMockedLast24h > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px', background: '#fef3c7', border: '1px solid var(--accent-gold)', borderRadius: '10px', marginBottom: '16px' }}>
          <AlertTriangle style={{ width: '18px', height: '18px', color: 'var(--accent-gold)', flexShrink: 0, marginTop: '2px' }} />
          <p style={{ fontSize: '13px', color: '#78350f', margin: 0 }}>
            <strong>{data.failedOrMockedLast24h}</strong> message{data.failedOrMockedLast24h === 1 ? '' : 's'} in the last 24 hours did not actually reach a phone (mocked or failed) — filter by status below to see which, and check the Text.lk API token/sender ID for this org if it's "Mocked".
          </p>
        </div>
      )}

      {/* Filter Toolbar */}
      <div style={{ padding: '14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '10px', marginBottom: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="f-sms-search" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Search (Name / Phone)</label>
          <input id="f-sms-search"
            type="text"
            className="glass-input"
            placeholder="e.g. Bandara, 0771234567"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '7px 10px', fontSize: '13px' }}
          />
        </div>
        <div>
          <label htmlFor="f-sms-status" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Status</label>
          <select id="f-sms-status" className="glass-input" style={{ padding: '7px 10px', fontSize: '13px' }} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="sent">Sent</option>
            <option value="mocked">Mocked (not configured)</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-sms-from" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>From Date</label>
          <input id="f-sms-from" type="date" className="glass-input" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ padding: '7px 10px', fontSize: '13px' }} />
        </div>
        <div>
          <label htmlFor="f-sms-to" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>To Date</label>
          <input id="f-sms-to" type="date" className="glass-input" value={toDate} onChange={e => setToDate(e.target.value)} style={{ padding: '7px 10px', fontSize: '13px' }} />
        </div>
      </div>

      {loading && !data ? (
        <SkeletonCards count={5} lines={2} />
      ) : !data || data.data.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Smartphone style={{ width: '28px', height: '28px' }} /></div>
          <h4 className="empty-state-title">No SMS Log Entries Found</h4>
          <p className="empty-state-text">No messages match the current filter selection.</p>
        </div>
      ) : (
        <>
          <div className="desktop-only" style={{ overflowX: 'auto' }}>
            <table className="glass-table">
              <thead>
                <tr>
                  <th>Date/Time</th>
                  <th>Recipient</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map(log => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString()}</td>
                    <td>{log.recipient_name || '—'}{log.role ? ` (${log.role})` : ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{log.phone}</td>
                    <td><SmsStatusBadge status={log.status} /></td>
                    <td style={{ fontSize: '12px', maxWidth: '360px' }} title={log.error || log.message}>
                      {log.status === 'failed' && log.error ? <span style={{ color: 'var(--accent-rose)' }}>{log.error}</span> : log.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mobile-only mobile-card-list">
            {data.data.map(log => (
              <div key={log.id} className="mobile-row-card">
                <div className="mobile-row-card-header">
                  <SmsStatusBadge status={log.status} />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(log.created_at).toLocaleString()}</span>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{log.recipient_name || '—'}{log.role ? ` (${log.role})` : ''} · {log.phone}</span>
                <p style={{ fontSize: '13px', margin: '4px 0 0', color: log.status === 'failed' && log.error ? 'var(--accent-rose)' : 'var(--text-primary)' }}>
                  {log.status === 'failed' && log.error ? log.error : log.message}
                </p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} disabled={page === 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>
              ← Prev
            </button>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Page {data.page} of {data.totalPages} ({data.total} entries)</span>
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} disabled={page === data.totalPages || loading} onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Full, paginated payment history across all agents/borrowers with multi-criteria filters
function PaymentHistoryLoader() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (paymentMethod) params.set('paymentMethod', paymentMethod);
    if (paymentType) params.set('paymentType', paymentType);

    api.get(`/payments/history?${params.toString()}`)
      .then(res => setData(res))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, fromDate, toDate, paymentMethod, paymentType]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, fromDate, toDate, paymentMethod, paymentType]);

  const clearFilters = () => {
    setSearch('');
    setFromDate('');
    setToDate('');
    setPaymentMethod('');
    setPaymentType('');
  };

  const hasActiveFilters = search || fromDate || toDate || paymentMethod || paymentType;

  // Was exporting only the current 25-row page (the button even said so:
  // "Export CSV (25)") — useless for the actual use case of handing a
  // date range to an accountant. Re-fetches every matching page at the
  // server's own 100-row cap and combines them into one file, honoring
  // whatever search/date/method/type filters are currently set. Capped
  // at 50 pages (5,000 rows) so a completely unfiltered export on a huge
  // history can't hang the browser fetching forever — tell the admin to
  // narrow the range if they hit it.
  const EXPORT_PAGE_SIZE = 100;
  const EXPORT_MAX_PAGES = 50;
  const handleExportCsv = async () => {
    if (!data || !data.total) return;
    setExporting(true);
    setExportError('');
    try {
      const totalPages = Math.ceil(data.total / EXPORT_PAGE_SIZE);
      const pagesToFetch = Math.min(totalPages, EXPORT_MAX_PAGES);
      const allRows = [];
      for (let p = 1; p <= pagesToFetch; p++) {
        const params = new URLSearchParams({ page: String(p), limit: String(EXPORT_PAGE_SIZE) });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (fromDate) params.set('from', fromDate);
        if (toDate) params.set('to', toDate);
        if (paymentMethod) params.set('paymentMethod', paymentMethod);
        if (paymentType) params.set('paymentType', paymentType);
        const res = await api.get(`/payments/history?${params.toString()}`);
        allRows.push(...res.data);
      }
      downloadCsv(
        `payment-history-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Date', 'Borrower', 'Agent', 'Type', 'Amount', 'Method', 'Security Code', 'Notes'],
        allRows.map(tx => [
          new Date(tx.payment_date).toLocaleString(),
          tx.borrower_name,
          tx.agent_name,
          tx.payment_type,
          parseFloat(tx.amount).toFixed(2),
          tx.payment_method,
          tx.idempotency_key || '',
          tx.notes || ''
        ])
      );
      if (totalPages > EXPORT_MAX_PAGES) {
        setExportError(`Exported the first ${pagesToFetch * EXPORT_PAGE_SIZE} of ${data.total} matching payments — narrow the date range to get the rest.`);
      }
    } catch (err) {
      setExportError('Export failed: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Receipt className="icon" style={{ color: 'var(--accent-blue)' }} /> Payment History Log
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {data ? `Showing page ${data.page} of ${data.totalPages} (${data.total} total payments)` : 'Transaction ledger'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="glass-btn glass-btn-secondary" style={{ padding: '8px 14px', fontSize: '12px' }} onClick={handleExportCsv} disabled={!data || data.total === 0 || exporting}>
            <Download className="icon" /> {exporting ? 'Exporting…' : `Export CSV (${data?.total || 0})`}
          </button>
          {hasActiveFilters && (
            <button type="button" className="glass-btn glass-btn-rose" style={{ padding: '8px 14px', fontSize: '12px' }} onClick={clearFilters}>
              <RefreshCcw className="icon" /> Reset Filters
            </button>
          )}
        </div>
      </div>

      {exportError && (
        <p style={{ fontSize: '12px', color: 'var(--accent-amber)', marginTop: '-12px', marginBottom: '16px' }}>{exportError}</p>
      )}

      {/* Advanced Filter Toolbar */}
      <div style={{ padding: '14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '10px', marginBottom: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="f-search-name-phone-nic-code-8737" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Search (Name / Phone / NIC / Code)</label>
          <input id="f-search-name-phone-nic-code-8737"
            type="text"
            className="glass-input"
            placeholder="e.g. Bandara, 1990..., idemp..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '7px 10px', fontSize: '13px' }}
          />
        </div>
        <div>
          <label htmlFor="f-from-date-8748" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>From Date</label>
          <input id="f-from-date-8748"
            type="date"
            className="glass-input"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            style={{ padding: '7px 10px', fontSize: '13px' }}
          />
        </div>
        <div>
          <label htmlFor="f-to-date-8758" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>To Date</label>
          <input id="f-to-date-8758"
            type="date"
            className="glass-input"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            style={{ padding: '7px 10px', fontSize: '13px' }}
          />
        </div>
        <div>
          <label htmlFor="f-payment-method-8768" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Payment Method</label>
          <select id="f-payment-method-8768" className="glass-input" style={{ padding: '7px 10px', fontSize: '13px' }} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
            <option value="">All Methods</option>
            <option value="cash">Cash Collection</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="mobile_wallet">Mobile Wallet</option>
            <option value="card">Card Payment</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-payment-type-8778" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Payment Type</label>
          <select id="f-payment-type-8778" className="glass-input" style={{ padding: '7px 10px', fontSize: '13px' }} value={paymentType} onChange={e => setPaymentType(e.target.value)}>
            <option value="">All Types</option>
            <option value="interest">Interest Payment</option>
            <option value="principal">Principal Repayment</option>
          </select>
        </div>
      </div>

      {loading && !data ? (
        <SkeletonCards count={5} lines={2} />
      ) : !data || data.data.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', padding: '16px 0' }}>No payments recorded yet.</p>
      ) : (
        <>
          <div className="desktop-only" style={{ overflowX: 'auto' }}>
            <table className="glass-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Borrower</th>
                  <th>Agent</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map(tx => (
                  <tr key={tx.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(tx.payment_date).toLocaleString()}</td>
                    <td>{tx.borrower_name}</td>
                    <td>{tx.agent_name}</td>
                    <td style={{ textTransform: 'capitalize' }}>{tx.payment_type === 'flat_installment' ? 'Daily installment' : tx.payment_type}</td>
                    <td style={{ fontWeight: 'bold' }}>LKR {parseFloat(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={{ textTransform: 'capitalize' }}>{(tx.payment_method || '').replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mobile-only mobile-card-list">
            {data.data.map(tx => (
              <div key={tx.id} className="mobile-row-card mobile-row-card-success">
                <div className="mobile-row-card-header">
                  <span className="mobile-row-card-title">{tx.borrower_name}</span>
                  <span style={{ fontWeight: 'bold', color: 'var(--accent-emerald)', fontSize: '15px' }}>LKR {parseFloat(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{new Date(tx.payment_date).toLocaleString()}</span>
                <div className="mobile-row-card-grid">
                  <span className="mobile-row-card-label">Agent</span>
                  <span className="mobile-row-card-value">{tx.agent_name}</span>

                  <span className="mobile-row-card-label">Type</span>
                  <span className="mobile-row-card-value" style={{ textTransform: 'capitalize' }}>{tx.payment_type === 'flat_installment' ? 'Daily installment' : tx.payment_type}</span>

                  <span className="mobile-row-card-label">Method</span>
                  <span className="mobile-row-card-value" style={{ textTransform: 'capitalize' }}>{(tx.payment_method || '').replace('_', ' ')}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} disabled={page === 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>
              ← Prev
            </button>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Page {data.page} of {data.totalPages} ({data.total} payments)</span>
            <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} disabled={page === data.totalPages || loading} onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Projects what the interest balance *should* be right now, extrapolating
// forward from the loan's last stored accrual — the DB's interest_balance
// only reflects whatever the daily cron has actually run so far, which can
// lag up to a full period (e.g. 24h for a daily loan) behind what's really
// owed if the borrower is checking mid-period. Display-only: never feeds
// back into anything real, since posting actual accruals is still the
// cron's job (src/lib/services/interest.js) — this just shows the
// borrower/agent an honest "as of right now" estimate alongside it.
function projectCurrentInterestBalance(loan) {
  const stored = parseFloat(loan.interest_balance) || 0;
  // Flat installment loans have their full interest total booked upfront
  // (see recordFlatInstallmentCollection) — nothing accrues incrementally,
  // so the stored balance already IS the current balance.
  if (loan.is_flat_installment) return stored;
  if (loan.status !== 'active' || !loan.next_accrual_date) return stored;

  const principal = parseFloat(loan.principal_amount) || 0;
  const rate = parseFloat(loan.interest_rate) || 0;
  const monthlyInterest = principal * (rate / 100);
  let interestPerPeriod = monthlyInterest;
  if (loan.interest_type === 'daily') {
    interestPerPeriod = monthlyInterest / 30;
  } else if (loan.interest_type === 'weekly') {
    interestPerPeriod = monthlyInterest / 4;
  }
  if (interestPerPeriod <= 0) return stored;

  const now = new Date();
  const maturity = loan.maturity_date ? new Date(loan.maturity_date) : null;
  let cursor = new Date(loan.next_accrual_date);
  let periods = 0;

  while (cursor <= now && periods < 500) {
    if (maturity && cursor > maturity) break;
    periods += 1;
    if (loan.interest_type === 'daily') cursor.setDate(cursor.getDate() + 1);
    else if (loan.interest_type === 'weekly') cursor.setDate(cursor.getDate() + 7);
    else if (loan.interest_type === 'monthly') cursor.setMonth(cursor.getMonth() + 1);
    else break;
    cursor.setHours(0, 0, 0, 0);
  }

  return stored + periods * interestPerPeriod;
}

// Record Payment Component - Inline collection entry sheet, split into
// Daily / Weekly / Monthly tabs (matching the app's three interest_type
// values). Each row is: Loan ID, Name, Due, a "Full Due" checkbox, and a
// "Partial" checkbox that reveals a custom-amount box when ticked — the two
// are mutually exclusive, since a row is either paid in full or a specific
// partial amount. Renders as a compact table on desktop and as stacked
// cards on mobile (a 7-column table forced horizontal scrolling on phones,
// which is exactly the "uncomfortable to scroll" complaint this replaces).
// Today's date, as the device's own local calendar day (not UTC) — used to
// default the collection-date picker below and to tell whether a selected
// date counts as "backdated".
const todayLocalDateStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// What's actually still owed for a flat-installment loan's CURRENT
// collection round — not just the flat daily rate. Without this, "Due"
// stayed at the fixed daily_installment_amount forever, even the instant
// after that exact amount had just been collected: pay today's LKR 1,000
// in full and the screen kept showing "Due: LKR 1,000.00" for the rest of
// the day, looking like the payment hadn't registered.
//
// Compares what SHOULD have been collected by today (elapsed calendar
// days since disbursement × the daily rate, Day 1 = disbursement day)
// against what actually HAS been collected so far (derived from how much
// of the original total term has been paid down) — so it reads as 0 once
// today's round is settled, and only grows again tomorrow (or sooner,
// as a catch-up figure, if a day was missed entirely).
const flatInstallmentDueToday = (loan) => {
  const dailyAmt = parseFloat(loan.daily_installment_amount) || 0;
  const totalTerm = dailyAmt * (parseFloat(loan.duration_periods) || 0);
  const remaining = (parseFloat(loan.principal_outstanding) || 0) + (parseFloat(loan.interest_balance) || 0);
  const collectedSoFar = Math.max(0, totalTerm - remaining);

  const start = new Date(loan.created_at);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const elapsedDays = Math.min(
    Math.max(1, Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1),
    parseFloat(loan.duration_periods) || 1
  );
  const expectedSoFar = dailyAmt * elapsedDays;

  return Math.max(0, Math.min(expectedSoFar - collectedSoFar, remaining));
};

function RecordDailyPaymentsTab({ loans = [], onRefresh, showToast }) {
  const [collectionType, setCollectionType] = useState('daily'); // 'daily', 'weekly', 'monthly'
  const [searchTerm, setSearchTerm] = useState('');
  // Only meaningful in admin usage (self-fetches every agent's loans mixed
  // together) — an agent's own view already only ever contains their own
  // loans, so the dropdown naturally has nothing to filter and stays hidden
  // (see the "> 1 distinct agent" check below).
  const [agentFilter, setAgentFilter] = useState('all');
  const [selectedRows, setSelectedRows] = useState({});
  const [submittingIds, setSubmittingIds] = useState({});
  const [fetchedLoans, setFetchedLoans] = useState([]);
  const [loadingLoans, setLoadingLoans] = useState(false);
  // Which day this batch of collections is being recorded for — defaults to
  // today, but an agent entering a round late (e.g. the next morning) can
  // set it back so the payment shows against the day it was actually
  // collected instead of the day it was typed in.
  const [collectionDate, setCollectionDate] = useState(todayLocalDateStr());

  // Self-fetch mode (admin usage always passes loans={[]}, a fresh empty
  // array every render — its .length is permanently 0, so this effect's
  // dependency never actually changes after mount). Extracted into a
  // named function so a successful payment can force a refetch too, not
  // just the initial mount — without this, an admin's Due figures here
  // went stale for the rest of the session after the very first payment,
  // which is exactly what let the same loan's stale "Full Due" amount get
  // submitted a second time as a genuine duplicate (see the Tharsika
  // double-payment this was built to fix).
  const fetchOwnLoans = () => {
    setLoadingLoans(true);
    return api.get('/loans?status=active')
      .then(res => setFetchedLoans(Array.isArray(res) ? res : []))
      .catch(err => console.error('Fetch loans error:', err))
      .finally(() => setLoadingLoans(false));
  };

  useEffect(() => {
    if (!loans || loans.length === 0) {
      fetchOwnLoans();
    }
  }, [loans?.length]);

  const activeSource = (loans && loans.length > 0) ? loans : fetchedLoans;
  const typeLoans = activeSource.filter(l => l.status === 'active' && l.interest_type === collectionType);

  // Distinct agents present in THIS collection type's loans, sorted by
  // name — recomputed per tab since "who has daily loans" and "who has
  // monthly loans" can be different sets of agents.
  const distinctAgents = Array.from(
    new Map(typeLoans.filter(l => l.assigned_agent_id).map(l => [l.assigned_agent_id, l.agent_name])).entries()
  ).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));

  const filteredLoans = typeLoans.filter(l => {
    if (agentFilter !== 'all' && String(l.assigned_agent_id) !== agentFilter) return false;
    if (!searchTerm) return true;
    const term = searchTerm.trim().toLowerCase();
    return (
      (l.borrower_name || '').toLowerCase().includes(term) ||
      (l.borrower_phone || '').includes(term) ||
      (l.nic_number || '').toLowerCase().includes(term) ||
      (l.reference_number || '').toLowerCase().includes(term) ||
      String(l.id).includes(term)
    );
  });

  const periodDue = (loan) => {
    if (loan.is_flat_installment) return flatInstallmentDueToday(loan);
    const monthlyInterest = (parseFloat(loan.principal_amount) || 0) * ((parseFloat(loan.interest_rate) || 0) / 100);
    if (loan.interest_type === 'daily') return monthlyInterest / 30;
    if (loan.interest_type === 'weekly') return monthlyInterest / 4;
    return monthlyInterest;
  };
  const periodLabel = { daily: '/day', weekly: '/week', monthly: '/month' }[collectionType];

  // Today's task-list split — paid_today comes from the API (checked against real transactions).
  // Critical fix: A loan is only fully settled for today if it had a payment recorded AND its remaining
  // due balance for today is zero. If a borrower made only a partial payment, they still have an active
  // shortfall/arrears due and must stay in remainingLoans so agents can follow up and collect the rest!
  const isFullySettledToday = (l) => {
    if (!l.paid_today) return false;
    const due = periodDue(l);
    return due <= 0;
  };

  const remainingLoans = filteredLoans.filter(l => !isFullySettledToday(l));
  const doneLoans = filteredLoans.filter(l => isFullySettledToday(l));
  const [showDoneToday, setShowDoneToday] = useState(false);

  const updateRowField = (loanId, field, value) => {
    setSelectedRows(prev => {
      const current = prev[loanId] || { mode: null, amount: '', paymentType: 'interest' };
      return {
        ...prev,
        [loanId]: { ...current, [field]: value }
      };
    });
  };

  // mode is 'full' or 'partial' — the two checkboxes are mutually exclusive.
  const handleToggleMode = (loan, mode, checked) => {
    // Flat installment loans: "Full Due" means today's flat amount (which
    // covers a mix of principal + interest), not the whole remaining
    // interest_balance the way every other loan type works — the borrower
    // isn't expected to pay off the entire remaining term in one day.
    const totalDue = loan.is_flat_installment
      ? Math.min(periodDue(loan), parseFloat(loan.principal_outstanding) + parseFloat(loan.interest_balance))
      : (parseFloat(loan.interest_balance) > 0 ? parseFloat(loan.interest_balance) : periodDue(loan));

    setSelectedRows(prev => {
      const current = prev[loan.id] || { paymentType: 'interest' };
      if (!checked) {
        return { ...prev, [loan.id]: { ...current, mode: null, amount: '' } };
      }
      return {
        ...prev,
        [loan.id]: {
          ...current,
          mode,
          amount: mode === 'full' ? Math.round(totalDue).toString() : ''
        }
      };
    });
  };

  const handleSavePaymentRow = async (loan) => {
    const row = selectedRows[loan.id] || {};
    const amountVal = parseFloat(row.amount);
    if (!amountVal || amountVal <= 0) {
      if (showToast) showToast('Please enter a valid payment amount.', 'error');
      return;
    }

    const paymentType = loan.is_flat_installment ? 'flat_installment' : (row.paymentType || 'interest');

    setSubmittingIds(prev => ({ ...prev, [loan.id]: true }));
    try {
      const idempotencyKey = `idemp_${collectionType}_${loan.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const isBackdated = collectionDate && collectionDate !== todayLocalDateStr();
      const typeLabel = paymentType === 'flat_installment' ? 'daily installment' : paymentType;
      const result = await submitPaymentOrQueue('/payments', {
        loan_id: loan.id,
        amount: amountVal,
        payment_type: paymentType,
        notes: `Recorded via Record Payment sheet (${collectionType})`,
        payment_method: 'cash',
        idempotency_key: idempotencyKey,
        ...(isBackdated ? { payment_date: collectionDate } : {})
      }, { borrowerName: loan.borrower_name, amount: amountVal, kind: typeLabel });

      if (result.queued) {
        // Deliberately does NOT clear the row or refresh Due figures here —
        // unlike a synced success, the server hasn't actually applied this
        // yet, so this loan should still show as needing collection until
        // the queued entry actually syncs (see the "Tharsika double-payment"
        // note above this component — the exact failure mode this avoids
        // is a stale-looking row getting submitted again as a genuine
        // duplicate because the UI implied it was already done).
        if (showToast) showToast(`No connection — LKR ${amountVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${typeLabel} payment for ${loan.borrower_name} saved and will sync automatically once you're back online.`, 'info');
      } else {
        if (showToast) showToast(`Recorded LKR ${amountVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${typeLabel} payment for ${loan.borrower_name}!`);

        // Clear completed row input
        setSelectedRows(prev => {
          const copy = { ...prev };
          delete copy[loan.id];
          return copy;
        });

        if (onRefresh) onRefresh();
        // onRefresh() only updates the PARENT's data (adminData/agentData) —
        // in self-fetch mode this screen's own loan list (fetchedLoans) is a
        // separate copy that onRefresh never touches, so it has to be
        // explicitly refreshed here too or this loan's Due figure stays
        // stale for the rest of the session.
        if (!loans || loans.length === 0) fetchOwnLoans();
      }
    } catch (err) {
      if (showToast) showToast(err.message || 'Payment recording failed.', 'error');
    } finally {
      setSubmittingIds(prev => ({ ...prev, [loan.id]: false }));
    }
  };

  const handleSaveAllSelected = async () => {
    const activeEntries = Object.entries(selectedRows).filter(([_, r]) => parseFloat(r.amount) > 0);
    if (activeEntries.length === 0) {
      if (showToast) showToast('No payment amounts entered.', 'error');
      return;
    }

    for (const [loanId] of activeEntries) {
      const loan = typeLoans.find(l => String(l.id) === String(loanId));
      if (loan) {
        await handleSavePaymentRow(loan);
      }
    }
  };

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '22px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CreditCard className="icon" style={{ color: 'var(--accent-blue)' }} /> Record Payment
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
            Tick Full Due, or tick Partial and enter a custom amount, then Save.
          </p>
        </div>
        <button
          type="button"
          className="glass-btn glass-btn-emerald"
          style={{ padding: '8px 16px', fontSize: '13px' }}
          onClick={handleSaveAllSelected}
        >
          <Check className="icon" /> Save All Entered
        </button>
      </div>

      {/* Collection-type tabs */}
      <div className="loan-file-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border-light)', gap: '8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: '16px' }}>
        {['daily', 'weekly', 'monthly'].map(t => (
          <button
            key={t}
            type="button"
            className="loan-file-tab"
            style={{
              padding: '10px 18px', fontSize: '13px', fontWeight: '700', textTransform: 'capitalize', whiteSpace: 'nowrap',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: collectionType === t ? '3px solid var(--accent-blue)' : '3px solid transparent',
              color: collectionType === t ? 'var(--accent-blue)' : 'var(--text-secondary)'
            }}
            onClick={() => setCollectionType(t)}
          >
            {t} ({activeSource.filter(l => l.status === 'active' && l.interest_type === t).length})
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <label htmlFor="collection-date-picker" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Calendar className="icon" style={{ width: '14px', height: '14px' }} /> Collection date
        </label>
        <input
          id="collection-date-picker"
          type="date"
          className="glass-input"
          value={collectionDate}
          max={todayLocalDateStr()}
          onChange={e => setCollectionDate(e.target.value)}
          style={{ width: 'auto', padding: '6px 10px', fontSize: '13px' }}
        />
        {collectionDate !== todayLocalDateStr() && (
          <span style={{ fontSize: '12px', color: 'var(--accent-amber)', fontWeight: '600' }}>
            Backdated — recording as if collected on this date, not today.
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          type="text"
          className="glass-input"
          placeholder="Search borrower, phone, NIC, or ID..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ flex: 1, minWidth: '200px' }}
        />
        {/* Only worth showing once there's actually more than one agent to
            tell apart — an agent's own view never has more than one. */}
        {distinctAgents.length > 1 && (
          <select className="glass-input" value={agentFilter} onChange={e => setAgentFilter(e.target.value)} style={{ width: 'auto', minWidth: '160px' }}>
            <option value="all">All Agents</option>
            {distinctAgents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>

      {!loadingLoans && filteredLoans.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', fontSize: '13px', fontWeight: '600', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--accent-rose)' }}>{remainingLoans.length} Remaining</span>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          <span style={{ color: 'var(--accent-emerald)' }}>{doneLoans.length} Done Today</span>
          {remainingLoans.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <Phone style={{ width: '13px', height: '13px', color: 'var(--accent-emerald)' }} /> Evening Follow-up: Click Call to directly dial uncollected borrowers
            </span>
          )}
        </div>
      )}

      {loadingLoans ? (
        <SkeletonCards count={4} lines={2} />
      ) : filteredLoans.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Search style={{ width: '28px', height: '28px' }} />
          </div>
          <h4 className="empty-state-title">No {collectionType} Collection Loans Found</h4>
          <p className="empty-state-text">
            {searchTerm ? `No ${collectionType} collection loans match "${searchTerm}".` : `There are no active ${collectionType} collection loans currently.`}
          </p>
        </div>
      ) : remainingLoans.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><CircleCheck style={{ width: '28px', height: '28px', color: 'var(--accent-emerald)' }} /></div>
          <h4 className="empty-state-title">All {collectionType} Collections Done for Today</h4>
          <p className="empty-state-text">Every {collectionType} loan has a payment recorded today — nothing left in this round.</p>
        </div>
      ) : (
        <>
          {/* Desktop: compact table */}
          <div className="desktop-only" style={{ overflowX: 'auto' }}>
            <table className="glass-table">
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>Loan ID</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Name & Contact</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Due Today</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Full Due</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Partial</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Type</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Save</th>
                </tr>
              </thead>
              <tbody>
                {remainingLoans.map(loan => {
                  // For a flat-installment (daily principal+interest bundled)
                  // loan, "Due" means today's fixed daily amount — the whole
                  // point of daily collection is a flat LKR X/day, not the
                  // loan's total remaining balance. Showing the full
                  // remaining balance as the prominent due figure here was
                  // misleading agents into thinking that was what needed
                  // collecting today.
                  const totalDue = loan.is_flat_installment
                    ? periodDue(loan)
                    : parseFloat(loan.interest_balance) || 0;
                  const row = selectedRows[loan.id] || { mode: null, amount: '', paymentType: 'interest' };
                  const isSubmitting = submittingIds[loan.id];
                  const cleanPhone = (loan.borrower_phone || '').replace(/[^0-9+]/g, '');
                  const waDigits = cleanPhone.replace(/[^0-9]/g, '');
                  const waNumber = waDigits.startsWith('0') ? '94' + waDigits.slice(1) : waDigits;

                  return (
                    <tr key={loan.id} style={{ transition: 'background-color 0.15s ease' }}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                        <span style={{ color: 'var(--accent-blue)', background: 'rgba(37, 84, 232, 0.08)', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}>
                          {loan.reference_number || `LN-${String(loan.id).padStart(3, '0')}`}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <strong style={{ display: 'block', fontSize: '14px' }}>
                          {loan.borrower_name}
                          {loan.paid_today && <span className="badge badge-pending" style={{ fontSize: '10px', marginLeft: '6px' }}>Partial Paid</span>}
                        </strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                          {cleanPhone ? (
                            <a
                              href={`tel:${cleanPhone}`}
                              className="glass-btn"
                              style={{
                                padding: '2px 8px',
                                fontSize: '11px',
                                fontWeight: '600',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                textDecoration: 'none',
                                color: '#ffffff',
                                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                borderRadius: '5px'
                              }}
                              title={`Directly dial ${loan.borrower_phone}`}
                            >
                              <Phone style={{ width: '11px', height: '11px' }} /> Call {loan.borrower_phone}
                            </a>
                          ) : (
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><Phone className="icon" /> {loan.borrower_phone || 'No phone'}</span>
                          )}
                          {cleanPhone && (
                            <a
                              href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hello ${loan.borrower_name}, this is a reminder regarding your loan payment of LKR ${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2 })} due today (${loan.reference_number || `LN-${loan.id}`}). Thank you.`)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#25D366', display: 'inline-flex', alignItems: 'center', padding: '2px 4px' }}
                              title="WhatsApp Reminder"
                            >
                              <MessageSquare style={{ width: '13px', height: '13px' }} />
                            </a>
                          )}
                        </div>
                        {loan.last5Days && <div style={{ marginTop: '4px' }}><Last5DaysStreak last5Days={loan.last5Days} /></div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 'bold', color: totalDue > 0 ? 'var(--accent-rose)' : 'var(--text-primary)', display: 'block' }}>
                          LKR {totalDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {loan.is_flat_installment
                            ? `Flat installment · LKR ${(parseFloat(loan.principal_outstanding || 0) + parseFloat(loan.interest_balance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })} remaining`
                            : `LKR ${periodDue(loan).toLocaleString(undefined, { minimumFractionDigits: 2 })}${periodLabel}`}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                        <input
                          type="checkbox"
                          checked={row.mode === 'full'}
                          onChange={e => handleToggleMode(loan, 'full', e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: 'var(--accent-emerald)', cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={row.mode === 'partial'}
                            onChange={e => handleToggleMode(loan, 'partial', e.target.checked)}
                            style={{ width: '18px', height: '18px', accentColor: 'var(--accent-amber)', cursor: 'pointer' }}
                          />
                          {row.mode === 'partial' && (
                            <input
                              type="number"
                              min="1"
                              autoFocus
                              placeholder="e.g. 200"
                              value={row.amount}
                              onChange={e => updateRowField(loan.id, 'amount', e.target.value)}
                              className="glass-input"
                              style={{ width: '110px', padding: '6px 10px', fontSize: '14px', fontWeight: 'bold' }}
                            />
                          )}
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                        {loan.is_flat_installment ? (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>Principal + Interest</span>
                        ) : (
                          <select
                            value={row.paymentType || 'interest'}
                            onChange={e => updateRowField(loan.id, 'paymentType', e.target.value)}
                            className="glass-input"
                            style={{ padding: '6px 8px', fontSize: '12px', width: '100px' }}
                          >
                            <option value="interest">Interest</option>
                            <option value="principal">Principal</option>
                          </select>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                        <button
                          type="button"
                          className="glass-btn glass-btn-emerald"
                          style={{ padding: '6px 14px', fontSize: '12px' }}
                          onClick={() => handleSavePaymentRow(loan)}
                          disabled={isSubmitting || !row.amount}
                        >
                          {isSubmitting ? 'Saving...' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: one compact card per loan instead of a wide table */}
          <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {remainingLoans.map(loan => {
              // Same reasoning as the desktop table above: for a flat
              // daily-installment loan, "Due" is today's fixed LKR X/day,
              // not the whole loan's remaining balance.
              const totalDue = loan.is_flat_installment
                ? periodDue(loan)
                : parseFloat(loan.interest_balance) || 0;
              const row = selectedRows[loan.id] || { mode: null, amount: '', paymentType: 'interest' };
              const isSubmitting = submittingIds[loan.id];
              const cleanPhone = (loan.borrower_phone || '').replace(/[^0-9+]/g, '');
              const waDigits = cleanPhone.replace(/[^0-9]/g, '');
              const waNumber = waDigits.startsWith('0') ? '94' + waDigits.slice(1) : waDigits;
              const remainingBal = (parseFloat(loan.principal_outstanding || 0) + parseFloat(loan.interest_balance || 0));

              return (
                <div key={loan.id} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div>
                      <span style={{ color: 'var(--accent-blue)', background: 'rgba(37, 84, 232, 0.08)', padding: '2px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>
                        {loan.reference_number || `LN-${String(loan.id).padStart(3, '0')}`}
                      </span>
                      <strong style={{ display: 'block', fontSize: '15px', marginTop: '4px' }}>
                        {loan.borrower_name}
                        {loan.paid_today && <span className="badge badge-pending" style={{ fontSize: '10px', marginLeft: '6px' }}>Partial Paid</span>}
                      </strong>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><Phone className="icon" style={{ width: '12px', height: '12px' }} /> {loan.borrower_phone || 'No phone'}</span>
                      {loan.last5Days && <div style={{ marginTop: '4px' }}><Last5DaysStreak last5Days={loan.last5Days} /></div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '700' }}>Due Today</span>
                      <span style={{ fontWeight: '800', fontSize: '17px', color: totalDue > 0 ? 'var(--accent-rose)' : 'var(--text-primary)', display: 'block' }}>
                        LKR {totalDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {loan.is_flat_installment
                          ? `Flat · LKR ${remainingBal.toLocaleString(undefined, { minimumFractionDigits: 2 })} bal`
                          : `LKR ${periodDue(loan).toLocaleString(undefined, { minimumFractionDigits: 2 })}${periodLabel} · Bal LKR ${remainingBal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                      </span>
                    </div>
                  </div>

                  {/* Evening Follow-up: 1-tap direct dial phone call button */}
                  {cleanPhone ? (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                      <a
                        href={`tel:${cleanPhone}`}
                        className="glass-btn"
                        style={{
                          flex: 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          minHeight: '42px',
                          padding: '8px 12px',
                          fontSize: '13px',
                          fontWeight: '700',
                          textDecoration: 'none',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          color: '#ffffff',
                          boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)'
                        }}
                        title={`Direct dial ${loan.borrower_phone}`}
                      >
                        <Phone style={{ width: '15px', height: '15px' }} /> Call Now ({loan.borrower_phone})
                      </a>
                      <a
                        href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hello ${loan.borrower_name}, this is a reminder regarding your loan payment of LKR ${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2 })} due today (${loan.reference_number || `LN-${loan.id}`}). Please arrange payment at your earliest convenience.`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="glass-btn"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          minHeight: '42px',
                          padding: '8px 12px',
                          fontSize: '12px',
                          fontWeight: '600',
                          textDecoration: 'none',
                          borderRadius: '8px',
                          background: 'rgba(37, 211, 102, 0.12)',
                          color: '#25D366',
                          border: '1px solid rgba(37, 211, 102, 0.35)'
                        }}
                        title="Send WhatsApp Reminder"
                      >
                        <MessageSquare style={{ width: '14px', height: '14px' }} /> WhatsApp
                      </a>
                    </div>
                  ) : (
                    <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      No phone number recorded for this borrower.
                    </div>
                  )}

                  {/* These two toggles mark real cash as collected — the exact
                      controls involved in a real double-payment incident, so
                      the tap target is deliberately generous: the full-width
                      flex:1 label (not just the checkbox) is clickable, at
                      least 44px tall per the usual minimum comfortable
                      touch-target size, with a visibly larger checkbox. */}
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-light)' }}>
                    <label style={{ flex: 1, minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', padding: '10px 12px', borderRadius: '8px', background: row.mode === 'full' ? 'var(--accent-blue-light)' : 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                      <input
                        type="checkbox"
                        checked={row.mode === 'full'}
                        onChange={e => handleToggleMode(loan, 'full', e.target.checked)}
                        style={{ width: '22px', height: '22px', accentColor: 'var(--accent-emerald)', cursor: 'pointer' }}
                      />
                      Full Due
                    </label>
                    <label style={{ flex: 1, minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', padding: '10px 12px', borderRadius: '8px', background: row.mode === 'partial' ? 'var(--accent-blue-light)' : 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                      <input
                        type="checkbox"
                        checked={row.mode === 'partial'}
                        onChange={e => handleToggleMode(loan, 'partial', e.target.checked)}
                        style={{ width: '22px', height: '22px', accentColor: 'var(--accent-amber)', cursor: 'pointer' }}
                      />
                      Partial
                    </label>
                  </div>

                  {row.mode === 'partial' && (
                    <input
                      type="number"
                      min="1"
                      autoFocus
                      placeholder="Enter partial amount, e.g. 200"
                      value={row.amount}
                      onChange={e => updateRowField(loan.id, 'amount', e.target.value)}
                      className="glass-input"
                      style={{ marginTop: '10px', fontWeight: 'bold' }}
                    />
                  )}

                  {row.mode && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                      {loan.is_flat_installment ? (
                        <span style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Principal + Interest</span>
                      ) : (
                        <select
                          value={row.paymentType || 'interest'}
                          onChange={e => updateRowField(loan.id, 'paymentType', e.target.value)}
                          className="glass-input"
                          style={{ flex: 1, padding: '8px 10px', fontSize: '13px' }}
                        >
                          <option value="interest">Interest</option>
                          <option value="principal">Principal</option>
                        </select>
                      )}
                      <button
                        type="button"
                        className="glass-btn glass-btn-emerald"
                        style={{ padding: '8px 18px', fontSize: '13px', whiteSpace: 'nowrap' }}
                        onClick={() => handleSavePaymentRow(loan)}
                        disabled={isSubmitting || !row.amount}
                      >
                        {isSubmitting ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Done Today — collapsed by default so it doesn't compete with
              the actionable Remaining list above, but still lets an agent
              double-check who they've already collected from today
              without leaving this screen. */}
          {doneLoans.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => setShowDoneToday(v => !v)}
                className="glass-btn glass-btn-secondary"
                style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <CircleCheck className="icon" style={{ color: 'var(--accent-emerald)' }} />
                {showDoneToday ? 'Hide' : 'Show'} {doneLoans.length} Done Today
              </button>
              {showDoneToday && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                  {doneLoans.map(loan => (
                    <div key={loan.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '8px', fontSize: '13px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CircleCheck className="icon" style={{ width: '14px', height: '14px', color: 'var(--accent-emerald)' }} />
                        <strong>{loan.borrower_name}</strong>
                        <span style={{ color: 'var(--text-muted)' }}>{loan.reference_number || `LN-${String(loan.id).padStart(3, '0')}`}</span>
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>{loan.borrower_phone}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Next-Day Tasklist Component - Shows tomorrow's expected collections categorized into Daily, Weekly, and Monthly
function NextDayTasklistTab({ loans = [], onSelectLoan, onNavigateRecordPayment }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [fetchedLoans, setFetchedLoans] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!loans || loans.length === 0) {
      setLoading(true);
      api.get('/loans?status=active')
        .then(res => setFetchedLoans(Array.isArray(res) ? res : []))
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [loans?.length]);

  const sourceLoans = (loans && loans.length > 0) ? loans : fetchedLoans;
  const activeLoans = sourceLoans.filter(l => l.status === 'active');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const dailyDueTomorrow = activeLoans.filter(l => l.interest_type === 'daily');

  const weeklyDueTomorrow = activeLoans.filter(l => {
    if (l.interest_type !== 'weekly') return false;
    if (!l.next_accrual_date) return true;
    const nextAcc = new Date(l.next_accrual_date);
    return nextAcc <= tomorrowEnd;
  });

  const monthlyDueTomorrow = activeLoans.filter(l => {
    if (l.interest_type !== 'monthly') return false;
    if (!l.next_accrual_date) return true;
    const nextAcc = new Date(l.next_accrual_date);
    return nextAcc <= tomorrowEnd;
  });

  const calcExpectedAmount = (l) => {
    // Flat Daily Installment loans: include today's flat installment PLUS any accumulated arrears/shortfall from prior days
    if (l.is_flat_installment) {
      const dueWithArrears = flatInstallmentDueToday(l);
      return dueWithArrears > 0 ? dueWithArrears : (parseFloat(l.daily_installment_amount) || 0);
    }

    const principal = parseFloat(l.principal_amount) || 0;
    const rate = parseFloat(l.interest_rate) || 0;
    const monthlyInterest = (principal * rate) / 100;

    if (l.interest_type === 'daily') return monthlyInterest / 30;
    if (l.interest_type === 'weekly') return monthlyInterest / 4;
    return monthlyInterest;
  };

  const totalDailyAmt = dailyDueTomorrow.reduce((sum, l) => sum + calcExpectedAmount(l), 0);
  const totalWeeklyAmt = weeklyDueTomorrow.reduce((sum, l) => sum + calcExpectedAmount(l), 0);
  const totalMonthlyAmt = monthlyDueTomorrow.reduce((sum, l) => sum + calcExpectedAmount(l), 0);
  const totalExpectedTomorrow = totalDailyAmt + totalWeeklyAmt + totalMonthlyAmt;

  let displayedList = [];
  if (activeTab === 'daily') displayedList = dailyDueTomorrow;
  else if (activeTab === 'weekly') displayedList = weeklyDueTomorrow;
  else if (activeTab === 'monthly') displayedList = monthlyDueTomorrow;
  else displayedList = [...dailyDueTomorrow, ...weeklyDueTomorrow, ...monthlyDueTomorrow];

  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    displayedList = displayedList.filter(l =>
      (l.borrower_name || '').toLowerCase().includes(term) ||
      (l.borrower_phone || '').includes(term) ||
      (l.reference_number || '').toLowerCase().includes(term) ||
      (l.nic_number || '').toLowerCase().includes(term)
    );
  }

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar className="icon" style={{ color: 'var(--accent-emerald)' }} /> Next-Day Collection Tasklist ({tomorrow.toLocaleDateString()})
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
            Scheduled collection tasklist for tomorrow. View and plan route collections categorized by frequency.
          </p>
        </div>

        <input
          type="text"
          className="glass-input"
          placeholder="Search borrower or NIC..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ padding: '8px 12px', minWidth: '220px' }}
        />
      </div>

      {/* KPI Cards Summary for Tomorrow */}
      <div className="responsive-grid-equal-4-col" style={{ marginBottom: '24px' }}>
        <div className="kpi-card kpi-card-emerald">
          <span className="kpi-lbl">Total Expected Tomorrow</span>
          <h3 className="kpi-val" style={{ color: 'var(--accent-emerald)' }}>LKR {Math.round(totalExpectedTomorrow).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Combined collections</span>
        </div>
        <div className="kpi-card kpi-card-blue">
          <span className="kpi-lbl">Daily Route</span>
          <h3 className="kpi-val">{dailyDueTomorrow.length} Loans</h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>LKR {Math.round(totalDailyAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className="kpi-card kpi-card-amber">
          <span className="kpi-lbl">Weekly Route</span>
          <h3 className="kpi-val">{weeklyDueTomorrow.length} Loans</h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>LKR {Math.round(totalWeeklyAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className="kpi-card kpi-card-rose">
          <span className="kpi-lbl">Monthly Route</span>
          <h3 className="kpi-val">{monthlyDueTomorrow.length} Loans</h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>LKR {Math.round(totalMonthlyAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      </div>

      {/* Category Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`glass-btn ${activeTab === 'all' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: '12px' }}
          onClick={() => setActiveTab('all')}
        >
          All Tomorrow ({dailyDueTomorrow.length + weeklyDueTomorrow.length + monthlyDueTomorrow.length})
        </button>
        <button
          type="button"
          className={`glass-btn ${activeTab === 'daily' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: '12px' }}
          onClick={() => setActiveTab('daily')}
        >
          Daily Collections ({dailyDueTomorrow.length})
        </button>
        <button
          type="button"
          className={`glass-btn ${activeTab === 'weekly' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: '12px' }}
          onClick={() => setActiveTab('weekly')}
        >
          Weekly Collections ({weeklyDueTomorrow.length})
        </button>
        <button
          type="button"
          className={`glass-btn ${activeTab === 'monthly' ? 'glass-btn-emerald' : 'glass-btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: '12px' }}
          onClick={() => setActiveTab('monthly')}
        >
          Monthly Collections ({monthlyDueTomorrow.length})
        </button>
      </div>

      {/* Tasklist Table */}
      {loading ? (
        <SkeletonCards count={4} lines={2} />
      ) : displayedList.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Calendar style={{ width: '28px', height: '28px' }} /></div>
          <h4 className="empty-state-title">No Collections Scheduled Tomorrow</h4>
          <p className="empty-state-text">No active loan collections fall under this route category for tomorrow.</p>
        </div>
      ) : (
        <>
          <div className="desktop-only" style={{ overflowX: 'auto' }}>
            <table className="glass-table">
              <thead>
                <tr>
                  <th>Loan Ref ID</th>
                  <th>Borrower Name</th>
                  <th>Category</th>
                  <th>Expected Collection Due</th>
                  <th>Outstanding Balance</th>
                  <th>Assigned Agent</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {displayedList.map(loan => {
                  const expectedAmt = calcExpectedAmount(loan);
                  // Flat installment loans owe both principal and interest
                  // together, so their meaningful "balance" figure is the
                  // combined total, not just the interest_balance column
                  // every other (interest-only) loan type uses.
                  const currentBal = loan.is_flat_installment
                    ? (parseFloat(loan.principal_outstanding) || 0) + (parseFloat(loan.interest_balance) || 0)
                    : parseFloat(loan.interest_balance) || 0;
                  const cleanPhone = (loan.borrower_phone || '').replace(/[^0-9+]/g, '');
                  const waDigits = cleanPhone.replace(/[^0-9]/g, '');
                  const waNumber = waDigits.startsWith('0') ? '94' + waDigits.slice(1) : waDigits;

                  return (
                    <tr key={loan.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                        <span style={{ color: 'var(--accent-blue)', background: 'rgba(37, 84, 232, 0.08)', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}>
                          {loan.reference_number || `LN-${String(loan.id).padStart(3, '0')}`}
                        </span>
                      </td>
                      <td>
                        <strong style={{ display: 'block' }}>{loan.borrower_name}</strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                          {cleanPhone ? (
                            <a href={`tel:${cleanPhone}`} className="glass-btn" style={{ padding: '2px 8px', fontSize: '11px', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none', color: '#fff', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', borderRadius: '5px' }} title={`Direct dial ${loan.borrower_phone}`}>
                              <Phone style={{ width: '11px', height: '11px' }} /> {loan.borrower_phone}
                            </a>
                          ) : (
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><Phone className="icon" /> {loan.borrower_phone || 'No phone'}</span>
                          )}
                          {cleanPhone && (
                            <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hello ${loan.borrower_name}, reminder regarding your loan payment of LKR ${Math.round(expectedAmt).toLocaleString(undefined, { minimumFractionDigits: 2 })} due (${loan.reference_number || `LN-${loan.id}`}).`)}`} target="_blank" rel="noopener noreferrer" style={{ color: '#25D366', display: 'inline-flex', alignItems: 'center' }} title="WhatsApp Reminder">
                              <MessageSquare style={{ width: '12px', height: '12px' }} />
                            </a>
                          )}
                        </div>
                        {loan.nic_number && <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>NIC: {loan.nic_number}</span>}
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>
                        <span className={`badge ${loan.interest_type === 'daily' ? 'badge-active' : 'badge-pending'}`}>
                          {loan.interest_type} collection{loan.is_flat_installment ? ' (flat)' : ''}
                        </span>
                      </td>
                      <td style={{ fontWeight: 'bold', color: 'var(--accent-emerald)' }}>
                        LKR {Math.round(expectedAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ fontWeight: 'bold', color: currentBal > 0 ? 'var(--accent-rose)' : 'var(--text-primary)' }}>
                        LKR {currentBal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td>{loan.agent_name || 'Office Collector'}</td>
                      <td>
                        <button
                          type="button"
                          className="glass-btn glass-btn-emerald"
                          style={{ padding: '6px 12px', fontSize: '12px' }}
                          onClick={() => {
                            if (onNavigateRecordPayment) onNavigateRecordPayment(loan);
                            else if (onSelectLoan) onSelectLoan(loan.id);
                          }}
                        >
                          Record Payment
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="mobile-only mobile-card-list">
            {displayedList.map(loan => {
              const expectedAmt = calcExpectedAmount(loan);
              const currentBal = loan.is_flat_installment
                ? (parseFloat(loan.principal_outstanding) || 0) + (parseFloat(loan.interest_balance) || 0)
                : parseFloat(loan.interest_balance) || 0;
              const cleanPhone = (loan.borrower_phone || '').replace(/[^0-9+]/g, '');
              const waDigits = cleanPhone.replace(/[^0-9]/g, '');
              const waNumber = waDigits.startsWith('0') ? '94' + waDigits.slice(1) : waDigits;

              return (
                <div key={loan.id} className="mobile-row-card">
                  <div className="mobile-row-card-header">
                    <span className="mobile-row-card-title">{loan.borrower_name}</span>
                    <span style={{ color: 'var(--accent-blue)', background: 'rgba(37, 84, 232, 0.08)', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold' }}>
                      {loan.reference_number || `LN-${String(loan.id).padStart(3, '0')}`}
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><Phone className="icon" style={{ width: '12px', height: '12px' }} /> {loan.borrower_phone || 'No phone'}</span>
                  <span className={`badge ${loan.interest_type === 'daily' ? 'badge-active' : 'badge-pending'}`} style={{ textTransform: 'capitalize', alignSelf: 'flex-start' }}>
                    {loan.interest_type} collection{loan.is_flat_installment ? ' (flat)' : ''}
                  </span>
                  <div className="mobile-row-card-grid">
                    <span className="mobile-row-card-label">Expected Due</span>
                    <span className="mobile-row-card-value" style={{ color: 'var(--accent-emerald)', fontWeight: 'bold' }}>LKR {Math.round(expectedAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>

                    <span className="mobile-row-card-label">Balance</span>
                    <span className="mobile-row-card-value" style={{ color: currentBal > 0 ? 'var(--accent-rose)' : 'var(--text-primary)' }}>LKR {currentBal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>

                    <span className="mobile-row-card-label">Agent</span>
                    <span className="mobile-row-card-value">{loan.agent_name || 'Office Collector'}</span>
                  </div>
                  <div className="mobile-row-card-actions" style={{ display: 'flex', gap: '8px' }}>
                    {cleanPhone && (
                      <a
                        href={`tel:${cleanPhone}`}
                        className="glass-btn"
                        style={{
                          flex: '1 1 auto',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '10px 14px',
                          fontSize: '13px',
                          fontWeight: '700',
                          textDecoration: 'none',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          color: '#ffffff'
                        }}
                        title={`Direct dial ${loan.borrower_phone}`}
                      >
                        <Phone style={{ width: '14px', height: '14px' }} /> Call
                      </a>
                    )}
                    <button
                      type="button"
                      className="glass-btn glass-btn-primary"
                      style={{ flex: '1 1 auto' }}
                      onClick={() => {
                        if (onNavigateRecordPayment) onNavigateRecordPayment(loan);
                        else if (onSelectLoan) onSelectLoan(loan.id);
                      }}
                    >
                      Record Payment
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
