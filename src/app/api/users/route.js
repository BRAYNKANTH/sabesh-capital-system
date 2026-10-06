import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { logError } from '@/lib/logger.js';

// List all users (Admin only), optionally filtered by role (comma-separated
// for multiple, e.g. ?role=admin,agent). Staff-management screens should
// always pass this — borrowers are customer records, not accounts, and
// mixing thousands of them into a "manage users" table makes it unusable
// and invites accidents like resetting a password that does nothing.
export async function GET(request) {
  try {
    await requireAuth(request, ['admin']);
    const roleParam = request.nextUrl.searchParams.get('role');
    const roles = roleParam ? roleParam.split(',').map((r) => r.trim()).filter(Boolean) : null;

    let query = db('users').select('id', 'name', 'email', 'phone', 'gender', 'role', 'is_active', 'must_change_password', 'finance_access', 'ticket_access', 'pawn_access', 'created_at');
    if (roles && roles.length) query = query.whereIn('role', roles);

    const users = await query.orderBy('created_at', 'desc');
    return NextResponse.json(users);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('List users error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to fetch users.' }, { status: 500 });
  }
}
