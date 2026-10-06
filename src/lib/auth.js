import jwt from 'jsonwebtoken';
import db from './db.js';
import { JWT_SECRET } from './jwt.js';

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getUserFromRequest(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.split(' ')[1]; // "Bearer <token>"
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Verifies the request's JWT, (optionally) checks the user's role, and
// re-checks is_active against the database. The JWT itself only proves the
// token was validly signed and not expired — it says nothing about whether
// the account has since been deactivated, so a deactivated user's token
// would otherwise keep working for up to 24h (its expiry) after an admin
// switches them off. This DB check closes that gap; it costs one indexed
// lookup per authenticated request, which is acceptable at this app's scale.
export async function requireAuth(request, allowedRoles = []) {
  const tokenUser = getUserFromRequest(request);
  if (!tokenUser) {
    throw new AuthError(401, 'Authentication token required or invalid/expired.');
  }

  const dbUser = await db('users').where({ id: tokenUser.id }).select('id', 'name', 'phone', 'role', 'is_active', 'finance_access', 'ticket_access', 'pawn_access').first();
  if (!dbUser || !dbUser.is_active) {
    throw new AuthError(401, 'Account is inactive or no longer exists. Please contact your administrator.');
  }

  // Role is re-read from the DB too, in case it changed since the token was
  // issued (e.g. a demoted admin shouldn't keep admin access on an old token).
  if (allowedRoles.length && !allowedRoles.includes(dbUser.role)) {
    throw new AuthError(403, `Forbidden. This action requires one of these roles: [${allowedRoles.join(', ')}]. Your role: '${dbUser.role}'`);
  }

  return { id: dbUser.id, name: dbUser.name, phone: dbUser.phone, role: dbUser.role, finance_access: !!dbUser.finance_access, ticket_access: !!dbUser.ticket_access, pawn_access: !!dbUser.pawn_access };
}
