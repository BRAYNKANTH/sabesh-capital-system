import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { getMemberDetails, saveMemberDetails, ChitDetailsError } from '@/lib/services/chitMemberDetails.js';
import { logError } from '@/lib/logger.js';

function handle(error, label, request) {
  if (error instanceof AuthError || error instanceof ChitDetailsError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  logError(label, error, { method: request.method, url: request.url });
  return NextResponse.json({ message: 'Something went wrong on the server. Please try again.' }, { status: 500 });
}

async function loadMember(id, memberId) {
  return db('ticket_members').where({ id: memberId, ticket_id: id }).first();
}

// The member's own details (NIC, address, NIC photos, photo — with the photos)
// and the optional guarantor (NIC + phone).
export async function GET(request, { params }) {
  try {
    const user = await requireAuth(request);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }
    const { id, memberId } = params;
    const member = await loadMember(id, memberId);
    if (!member) return NextResponse.json({ message: 'Member not found in this ticket group.' }, { status: 404 });
    const { details, guarantor } = await getMemberDetails(id, memberId);
    return NextResponse.json({ member: { id: member.id, name: member.name, phone: member.phone }, details, guarantor });
  } catch (error) {
    return handle(error, 'Get chit member details error', request);
  }
}

// Save a member's details and/or guarantor. Photos left out of `details` keep
// their stored value; `guarantor: null` removes the guarantor; leaving
// `guarantor` out leaves it untouched.
export async function PUT(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }
    const { id, memberId } = params;
    const member = await loadMember(id, memberId);
    if (!member) return NextResponse.json({ message: 'Member not found in this ticket group.' }, { status: 404 });

    const body = await request.json();
    if (body.details === undefined && body.guarantor === undefined) {
      return NextResponse.json({ message: 'Nothing to save.' }, { status: 400 });
    }
    const out = await db.transaction((trx) => saveMemberDetails(id, memberId, body, trx));

    const ticket = await db('tickets').where({ id }).first();
    const parts = [];
    if (out.details) parts.push(`${out.detailsCreated ? 'added' : 'updated'} details (NIC ${out.details.nic_number})`);
    if (out.guarantor) parts.push(`${out.guarantorCreated ? 'added' : 'updated'} guarantor (NIC ${out.guarantor.nic_number}, ${out.guarantor.phone})`);
    if (out.guarantorRemoved) parts.push('removed the guarantor');
    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_MEMBER_DETAILS',
      description: `Member '${member.name}' in ticket group '${ticket?.name}': ${parts.join('; ') || 'no change'}.`
    });
    return NextResponse.json({ details: out.details || null, guarantor: out.guarantor || null, guarantorRemoved: out.guarantorRemoved });
  } catch (error) {
    return handle(error, 'Save chit member details error', request);
  }
}
