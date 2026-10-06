import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '@/lib/db.js';
import { JWT_SECRET } from '@/lib/jwt.js';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit.js';
import { normalizePhone } from '@/lib/phone.js';
import { logError } from '@/lib/logger.js';

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const { limited, retryAfterMs } = checkRateLimit(`login:${ip}`, { windowMs: 15 * 60 * 1000, max: 10 });
    if (limited) {
      return NextResponse.json(
        { message: 'Too many login attempts from this network. Please wait 15 minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }

    const { phone, password } = await request.json();

    if (!phone || !password) {
      return NextResponse.json({ message: 'Phone number and password are required.' }, { status: 400 });
    }

    const normalized = normalizePhone(phone);
    if (normalized.length < 9) {
      return NextResponse.json({ message: 'Invalid phone number.' }, { status: 400 });
    }

    // Phone numbers are stored as typed (with or without +94/leading 0), so
    // match on the last 9 significant digits rather than requiring an exact
    // string match.
    const user = await db('users').whereRaw('phone LIKE ?', [`%${normalized}`]).first();
    if (!user || !user.is_active) {
      return NextResponse.json({ message: 'Invalid phone number or inactive account.' }, { status: 401 });
    }
    // Per-account lockout after repeated failed attempts was removed at the
    // client's request (it was locking out legitimate admins, e.g. Sabesh
    // Capital's own admin, after a handful of mistyped passwords). The
    // failed_login_attempts/locked_until columns are left in place — still
    // cleared below on a successful login — but nothing sets or checks them
    // anymore. The per-IP rate limit above (10 attempts / 15 min / network)
    // is untouched and still provides basic anti-automation protection.
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    if (user.failed_login_attempts || user.locked_until) {
      await db('users').where({ id: user.id }).update({ failed_login_attempts: 0, locked_until: null });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, phone: user.phone, role: user.role, finance_access: !!user.finance_access, ticket_access: !!user.ticket_access, pawn_access: !!user.pawn_access },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'USER_LOGIN',
      description: `User '${user.name}' logged in successfully.`
    });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        phone: user.phone,
        mustChangePassword: !!user.must_change_password,
        finance_access: !!user.finance_access,
        ticket_access: !!user.ticket_access,
        pawn_access: !!user.pawn_access
      }
    });
  } catch (error) {
    logError('Login error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Internal server error during login.' }, { status: 500 });
  }
}
