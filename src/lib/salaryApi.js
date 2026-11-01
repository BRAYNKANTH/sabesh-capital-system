import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from './auth.js';
import { SalaryError } from './services/salary.js';
import { logError } from './logger.js';

// Every Salary API route is admin-only AND needs the per-user Salary access
// switch (users.salary_access, off by default).
export async function requireSalaryAdmin(request) {
  const user = await requireAuth(request, ['admin']);
  if (!user.salary_access) {
    throw new AuthError(403, 'Forbidden. You do not have access to the Salary portal.');
  }
  return user;
}

export function salaryErrorResponse(error, label, request) {
  if (error instanceof AuthError || error instanceof SalaryError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  logError(label, error, { method: request.method, url: request.url });
  return NextResponse.json({ message: 'Something went wrong on the server. Please try again.' }, { status: 500 });
}
