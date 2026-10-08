import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { checkRateLimit } from '@/lib/rateLimit.js';
import { logError } from '@/lib/logger.js';

// Admin sets a new password for any admin or agent directly — for when the
// SMS "Send Reset Code" route isn't an option (e.g. Text.lk isn't set up
// for this organisation, so no code ever reaches the user's phone).
//
// Safeguards, mirroring delete-user: the acting admin must re-enter THEIR
// OWN password, attempts are rate-limited, the new password is never logged,
// and the change is recorded in the audit log. By default the user is made to
// choose their own password at next login (must_change_password), so the one
// the admin typed is only a temporary hand-over.
export async function POST(request, { params }) {
  try {
    const authUser = await requireAuth(request, ['admin']);
    const { id } = params;
    const { new_password, admin_password, require_change } = await request.json();

    const { limited, retryAfterMs } = checkRateLimit(`set-password-auth:${authUser.id}`, { windowMs: 15 * 60 * 1000, max: 10 });
    if (limited) {
      return NextResponse.json(
        { message: 'Too many attempts. Please wait 15 minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }

    if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
      return NextResponse.json({ message: 'The new password must be at least 6 characters long.' }, { status: 400 });
    }
    if (!admin_password) {
      return NextResponse.json({ message: 'Enter your own password to confirm this change.' }, { status: 400 });
    }

    const adminUser = await db('users').where({ id: authUser.id }).first();
    const adminOk = adminUser && await bcrypt.compare(admin_password, adminUser.password_hash);
    if (!adminOk) {
      // 403, not 401: the web client treats any 401 as "session expired" and logs the user out.
      return NextResponse.json({ message: 'Your password is incorrect.' }, { status: 403 });
    }

    const target = await db('users').where({ id }).first();
    if (!target) {
      return NextResponse.json({ message: 'User not found.' }, { status: 404 });
    }
    if (target.role === 'borrower') {
      return NextResponse.json({ message: 'Borrowers have no login, so there is no password to set.' }, { status: 400 });
    }

    const isSelf = target.id === authUser.id;
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(new_password, salt);

    await db('users').where({ id: target.id }).update({
      password_hash: passwordHash,
      must_change_password: isSelf ? false : require_change !== false,
      failed_login_attempts: 0,
      locked_until: null,
      reset_otp_hash: null,
      reset_otp_expires_at: null,
      reset_otp_attempts: 0,
      updated_at: db.fn.now()
    });

    await db('audit_logs').insert({
      actor_id: authUser.id,
      action_type: 'SET_PASSWORD',
      description: isSelf
        ? `Admin '${authUser.name}' changed their own password from the user list.`
        : `Admin '${authUser.name}' set a new password for user '${target.name}' (${target.role})${require_change !== false ? ' — they must change it at next login' : ''}.`
    });

    return NextResponse.json({
      message: isSelf
        ? 'Your password has been changed.'
        : `${target.name}'s password has been set.${require_change !== false ? ' They will be asked to choose their own password the next time they log in.' : ''}`
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Set password error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Internal server error while setting the password.' }, { status: 500 });
  }
}
