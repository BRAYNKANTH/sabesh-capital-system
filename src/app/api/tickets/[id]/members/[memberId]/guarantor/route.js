import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { getGuarantor, upsertGuarantor, ChitGuarantorError } from '@/lib/services/chitGuarantor.js';
import { logError } from '@/lib/logger.js';

function handle(error, label, request) {
  if (error instanceof AuthError || error instanceof ChitGuarantorError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  logError(label, error, { method: request.method, url: request.url });
  return NextResponse.json({ message: 'Something went wrong on the server. Please try again.' }, { status: 500 });
}

async function loadMember(id, memberId) {
  return db('ticket_members').where({ id: memberId, ticket_id: id }).first();
}

// Full guarantor record (with photos) for one member.
export async function GET(request, { params }) {
  try {
    const user = await requireAuth(request);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }
    const { id, memberId } = params;
    const member = await loadMember(id, memberId);
    if (!member) return NextResponse.json({ message: 'Member not found in this ticket group.' }, { status: 404 });
    const guarantor = await getGuarantor(id, memberId);
    return NextResponse.json({ member: { id: member.id, name: member.name }, guarantor });
  } catch (error) {
    return handle(error, 'Get chit guarantor error', request);
  }
}

// Add or replace a member's guarantor. Photos left out of the request keep
// their stored value; send an empty list / null to clear them.
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
    const { guarantor, created } = await upsertGuarantor(id, memberId, body);

    const ticket = await db('tickets').where({ id }).first();
    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: created ? 'TICKET_GUARANTOR_ADD' : 'TICKET_GUARANTOR_UPDATE',
      description: `${created ? 'Added' : 'Updated'} guarantor '${guarantor.full_name}' (NIC ${guarantor.nic_number}) for member '${member.name}' in ticket group '${ticket?.name}'.`
    });
    return NextResponse.json({ guarantor }, { status: created ? 201 : 200 });
  } catch (error) {
    return handle(error, 'Save chit guarantor error', request);
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }
    const { id, memberId } = params;
    const member = await loadMember(id, memberId);
    if (!member) return NextResponse.json({ message: 'Member not found in this ticket group.' }, { status: 404 });
    const existing = await getGuarantor(id, memberId);
    if (!existing) return NextResponse.json({ message: 'This member has no guarantor on file.' }, { status: 404 });

    await db('ticket_member_guarantors').where({ id: existing.id }).del();
    const ticket = await db('tickets').where({ id }).first();
    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_GUARANTOR_REMOVE',
      description: `Removed guarantor '${existing.full_name}' from member '${member.name}' in ticket group '${ticket?.name}'.`
    });
    return NextResponse.json({ message: 'Guarantor removed.' });
  } catch (error) {
    return handle(error, 'Remove chit guarantor error', request);
  }
}
