import { NextResponse } from 'next/server';
import { requirePawnAdmin, pawnErrorResponse } from '@/lib/pawnApi.js';
import { returnPawnItem } from '@/lib/services/pawn.js';

export async function POST(request, { params }) {
  try {
    const user = await requirePawnAdmin(request);
    const body = await request.json().catch(() => ({}));
    const loan = await returnPawnItem({ loanId: params.id, note: body.note }, user.id);
    return NextResponse.json({ message: 'Item marked as returned to the customer.', loan });
  } catch (error) {
    return pawnErrorResponse(error, 'Return pawn item error', request);
  }
}
