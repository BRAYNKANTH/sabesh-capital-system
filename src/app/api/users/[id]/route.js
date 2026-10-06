import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { normalizePhone } from '@/lib/phone.js';
import bcrypt from 'bcryptjs';
import { checkRateLimit } from '@/lib/rateLimit.js';
import { logError } from '@/lib/logger.js';

// Permanently delete a user (Admin only). Blocked if the user has any
// loan/transaction/remittance history — that history is part of the audit
// trail and the ledger, so it can't be deleted out from under it. Use
// deactivate (PATCH /status) for users who've been active in the system;
// this is only for removing accounts that were never really used.
//
// Requires the admin to re-enter their own password, same idea as a
// destructive-action re-auth prompt elsewhere: being logged in proves who
// you are for browsing, not that you specifically mean to do this one
// irreversible thing right now. The password travels in the request body,
// not the URL — a query string can end up in server access logs.
export async function DELETE(request, { params }) {
  try {
    const authUser = await requireAuth(request, ['admin']);
    const { id } = params;
    const { password } = await request.json();

    if (!password) {
      return NextResponse.json({ message: 'Password confirmation is required to delete a user.' }, { status: 400 });
    }

    // Same per-account limiter shape as login — this endpoint lets someone
    // repeatedly guess the admin's password if left unthrottled.
    const { limited, retryAfterMs } = checkRateLimit(`delete-user-auth:${authUser.id}`, { windowMs: 15 * 60 * 1000, max: 10 });
    if (limited) {
      return NextResponse.json(
        { message: 'Too many attempts. Please wait 15 minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }

    const adminUser = await db('users').where({ id: authUser.id }).first();
    const isMatch = adminUser && await bcrypt.compare(password, adminUser.password_hash);
    if (!isMatch) {
      return NextResponse.json({ message: 'Invalid password. Deletion denied.' }, { status: 401 });
    }

    if (id === authUser.id) {
      return NextResponse.json({ message: 'You cannot delete your own account.' }, { status: 400 });
    }

    const targetUser = await db('users').where({ id }).first();
    if (!targetUser) {
      return NextResponse.json({ message: 'User not found.' }, { status: 404 });
    }

    const [loanCount, transactionCount, remittanceCount] = await Promise.all([
      db('loans').where({ borrower_id: id }).orWhere({ lender_id: id }).orWhere({ assigned_agent_id: id }).count('id as count').first(),
      db('transactions').where({ agent_id: id }).orWhere({ borrower_id: id }).count('id as count').first(),
      db('remittances').where({ agent_id: id }).count('id as count').first()
    ]);

    const hasHistory = parseInt(loanCount.count, 10) > 0 || parseInt(transactionCount.count, 10) > 0 || parseInt(remittanceCount.count, 10) > 0;
    if (hasHistory) {
      return NextResponse.json(
        { message: `${targetUser.name} has existing loan/payment history and can't be deleted — deactivate the account instead to preserve the audit trail.` },
        { status: 400 }
      );
    }

    await db('users').where({ id }).delete();

    await db('audit_logs').insert({
      actor_id: authUser.id,
      action_type: 'USER_DELETED',
      description: `Admin permanently deleted user '${targetUser.name}' (${targetUser.role}), who had no loan/payment history.`
    });

    return NextResponse.json({ message: `${targetUser.name} deleted.` });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Delete user error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to delete user.' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const authUser = await requireAuth(request);
    const { id } = params;

    if (authUser.role !== 'admin' && authUser.id !== id) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const { name, phone, role, email, gender, finance_access, ticket_access, pawn_access } = await request.json();

    const targetUser = await db('users').where({ id }).first();
    if (!targetUser) {
      return NextResponse.json({ message: 'User not found.' }, { status: 404 });
    }

    const updates = {};
    const changes = [];

    if (name !== undefined) {
      const cleanName = name.trim();
      if (!cleanName) {
        return NextResponse.json({ message: 'Name cannot be empty.' }, { status: 400 });
      }
      updates.name = cleanName;
      changes.push(`name: '${targetUser.name}' -> '${cleanName}'`);
    }

    if (phone !== undefined) {
      const cleanPhone = phone.trim().replace(/\s+/g, '');
      if (!cleanPhone) {
        return NextResponse.json({ message: 'Phone number cannot be empty.' }, { status: 400 });
      }
      const normalized = normalizePhone(cleanPhone);
      const existingUser = await db('users')
        .whereRaw('phone LIKE ?', [`%${normalized}`])
        .andWhereNot({ id })
        .first();
      if (existingUser) {
        return NextResponse.json({ message: 'Phone number is already registered by another user.' }, { status: 400 });
      }
      updates.phone = cleanPhone;
      changes.push(`phone: '${targetUser.phone}' -> '${cleanPhone}'`);
    }

    if (role !== undefined) {
      if (authUser.role !== 'admin') {
        return NextResponse.json({ message: 'Only admins can change user roles.' }, { status: 403 });
      }
      if (!['admin', 'agent', 'borrower'].includes(role)) {
        return NextResponse.json({ message: 'Invalid role specified.' }, { status: 400 });
      }
      if (id === authUser.id && role !== 'admin') {
        return NextResponse.json({ message: 'You cannot change your own role.' }, { status: 400 });
      }
      updates.role = role;
      changes.push(`role: '${targetUser.role}' -> '${role}'`);
    }

    if (email !== undefined) {
      const cleanEmail = email && email.trim() ? email.trim().toLowerCase() : null;
      if (cleanEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
          return NextResponse.json({ message: 'Invalid email format.' }, { status: 400 });
        }
        const existingEmail = await db('users')
          .where({ email: cleanEmail })
          .andWhereNot({ id })
          .first();
        if (existingEmail) {
          return NextResponse.json({ message: 'Email address is already registered to another user.' }, { status: 400 });
        }
      }
      updates.email = cleanEmail;
      changes.push(`email: '${targetUser.email || 'none'}' -> '${cleanEmail || 'none'}'`);
    }

    if (gender !== undefined) {
      const cleanGender = gender ? gender.trim() : null;
      updates.gender = cleanGender;
      changes.push(`gender: '${targetUser.gender || 'none'}' -> '${cleanGender || 'none'}'`);
    }

    if (finance_access !== undefined) {
      updates.finance_access = !!finance_access;
      changes.push(`finance_access: '${targetUser.finance_access}' -> '${!!finance_access}'`);
    }

    if (ticket_access !== undefined) {
      updates.ticket_access = !!ticket_access;
      changes.push(`ticket_access: '${targetUser.ticket_access}' -> '${!!ticket_access}'`);
    }

    if (pawn_access !== undefined) {
      updates.pawn_access = !!pawn_access;
      changes.push(`pawn_access: '${targetUser.pawn_access}' -> '${!!pawn_access}'`);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ message: 'No editable fields supplied (name, phone, role, email, gender, finance_access, ticket_access, pawn_access).' }, { status: 400 });
    }

    updates.updated_at = db.fn.now();
    await db('users').where({ id }).update(updates);

    await db('audit_logs').insert({
      actor_id: authUser.id,
      action_type: 'USER_UPDATED',
      description: `Admin updated user '${targetUser.name}' (${id}): ${changes.join(', ')}.`
    });

    // Never select('*') for a response that reaches the client — this
    // previously sent the bcrypt password_hash straight back in the JSON.
    const updatedUser = await db('users').where({ id }).select('id', 'name', 'email', 'phone', 'gender', 'role', 'is_active', 'must_change_password', 'finance_access', 'ticket_access', 'pawn_access', 'created_at').first();
    return NextResponse.json({ message: 'User updated successfully.', user: updatedUser });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Update user error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to update user details.' }, { status: 500 });
  }
}
