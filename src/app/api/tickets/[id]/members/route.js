import { NextResponse } from 'next/server';
import db from '@/lib/db.js';
import { requireAuth, AuthError } from '@/lib/auth.js';
import { upsertGuarantor, ChitGuarantorError } from '@/lib/services/chitGuarantor.js';
import { logError } from '@/lib/logger.js';

export async function GET(request, { params }) {
  try {
    const user = await requireAuth(request);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const members = await db('ticket_members').where({ ticket_id: id }).orderBy('name', 'asc');
    // Guarantor summary only — the photos are large, so they are fetched on demand
    // from /members/[memberId]/guarantor instead of riding along in every list.
    const guarantors = await db('ticket_member_guarantors')
      .where({ ticket_id: id })
      .select('member_id', 'full_name', 'nic_number', 'phone', 'address',
        db.raw('COALESCE(jsonb_array_length(nic_photo_urls), 0) as nic_photo_count'),
        db.raw('(photo_url IS NOT NULL) as has_photo'));
    const byMember = new Map(guarantors.map((g) => [g.member_id, g]));
    return NextResponse.json(members.map((m) => {
      const g = byMember.get(m.id);
      return { ...m, guarantor: g ? { full_name: g.full_name, nic_number: g.nic_number, phone: g.phone, address: g.address, nic_photo_count: Number(g.nic_photo_count), has_photo: !!g.has_photo } : null };
    }));
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('List ticket members error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to fetch ticket members.' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const user = await requireAuth(request, ['admin']);
    if (!user.ticket_access) {
      return NextResponse.json({ message: 'Forbidden. You do not have access to the Ticket system.' }, { status: 403 });
    }

    const { id } = params;
    const { name, phone, guarantor } = await request.json();

    if (!name) {
      return NextResponse.json({ message: 'Member name is required.' }, { status: 400 });
    }

    // Check if member limit is already reached
    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) {
      return NextResponse.json({ message: 'Ticket group not found.' }, { status: 404 });
    }

    const [{ count }] = await db('ticket_members').where({ ticket_id: id }).count('id as count');
    if (parseInt(count, 10) >= ticket.member_count) {
      return NextResponse.json({ message: `Cannot add member. Group member limit of ${ticket.member_count} reached.` }, { status: 400 });
    }

    // The member and their guarantor are saved together or not at all.
    const member = await db.transaction(async (trx) => {
      const [created] = await trx('ticket_members').insert({
        ticket_id: id,
        name: name.trim(),
        phone: phone ? phone.trim() : null
      }).returning('*');
      if (guarantor) await upsertGuarantor(id, created.id, guarantor, trx);
      return created;
    });

    await db('audit_logs').insert({
      actor_id: user.id,
      action_type: 'TICKET_MEMBER_ADD',
      description: `Added member '${name}' to ticket group '${ticket.name}'${guarantor ? ` with guarantor '${String(guarantor.full_name || '').trim()}'` : ''}.`
    });

    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError || error instanceof ChitGuarantorError) return NextResponse.json({ message: error.message }, { status: error.status });
    logError('Add ticket member error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Failed to add member.' }, { status: 500 });
  }
}
