import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from './auth.js';
import { PawnError } from './services/pawn.js';
import { logError } from './logger.js';

// Every Pawn API route is admin-only AND needs the per-user Pawn access
// switch (users.pawn_access, off by default).
export async function requirePawnAdmin(request) {
  const user = await requireAuth(request, ['admin']);
  if (!user.pawn_access) {
    throw new AuthError(403, 'Forbidden. You do not have access to the Pawn portal.');
  }
  return user;
}

export function pawnErrorResponse(error, label, request) {
  if (error instanceof AuthError || error instanceof PawnError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  logError(label, error, { method: request.method, url: request.url });
  return NextResponse.json({ message: 'Something went wrong on the server. Please try again.' }, { status: 500 });
}
