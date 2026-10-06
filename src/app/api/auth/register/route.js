import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { normalizePhone } from '@/lib/phone.js';
import { generateTempPassword } from '@/lib/tempPassword.js';
import { logError } from '@/lib/logger.js';

export async function POST(request) {
  try {
    const user = await requireAuth(request, ['admin']);
    const { name, phone, password, role, email, gender, finance_access, ticket_access, pawn_access } = await request.json();

    if (!name || !phone || !role) {
      return NextResponse.json({ message: 'Name, phone, and role are required.' }, { status: 400 });
    }
    if (role !== 'borrower' && !password) {
      return NextResponse.json({ message: 'Password is required for administrators and collection agents.' }, { status: 400 });
    }
    if (!['admin', 'agent', 'borrower'].includes(role)) {
      return NextResponse.json({ message: 'Invalid role specified.' }, { status: 400 });
    }

    const normalized = normalizePhone(phone);
    const existingUser = await db('users').whereRaw('phone LIKE ?', [`%${normalized}`]).first();
    if (existingUser) {
      return NextResponse.json({ message: 'Phone number is already registered.' }, { status: 400 });
    }

    let cleanEmail = null;
    if (email && email.trim()) {
      cleanEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return NextResponse.json({ message: 'Invalid email format.' }, { status: 400 });
      }
      const existingEmail = await db('users').where({ email: cleanEmail }).first();
      if (existingEmail) {
        return NextResponse.json({ message: 'Email address is already registered to another user.' }, { status: 400 });
      }
    }

    let passwordHash;
    let tempPassword = null;
    let mustChangePassword = false;
    if (role === 'borrower') {
      // Borrowers don't log in — this is a deliberately invalid bcrypt hash
      // that bcrypt.compare() always rejects, regardless of any password
      // supplied in the request.
      passwordHash = 'NO_LOGIN_ACCESS';
    } else if (password) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password, salt);
    } else {
      // Shouldn't be reachable given the check above, but generate a real
      // temp password rather than ever leaving passwordHash undefined.
      tempPassword = generateTempPassword();
      mustChangePassword = true;
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(tempPassword, salt);
    }

    const [userId] = await db('users').insert({
      name: name.trim(),
      phone: phone.trim().replace(/\s+/g, ''),
      email: cleanEmail,
      gender: gender || null,
      password_hash: passwordHash,
      role,
      is_active: true,
      must_change_password: mustChangePassword,
      finance_access: finance_access !== undefined ? !!finance_access : true,
      ticket_access: ticket_access !== undefined ? !!ticket_access : true,
      pawn_access: role === 'admin' && !!pawn_access
    }).returning('id');

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'USER_REGISTRATION',
      description: `Registered new user '${name}' with role '${role}'.`
    });

    return NextResponse.json({
      message: 'User registered successfully.',
      userId: userId.id || userId,
      temporaryPassword: tempPassword
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Registration error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Internal server error during registration.' }, { status: 500 });
  }
}
