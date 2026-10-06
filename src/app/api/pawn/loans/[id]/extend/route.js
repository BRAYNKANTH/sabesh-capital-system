import { NextResponse } from 'next/server';
import { requirePawnAdmin, pawnErrorResponse } from '@/lib/pawnApi.js';
import { extendPawnLoan } from '@/lib/services/pawn.js';

export async function POST(request, { params }) {
  try {
    const user = await requirePawnAdmin(request);
    const { additional_months, reason } = await request.json();
    const loan = await extendPawnLoan({ loanId: params.id, additionalMonths: additional_months, reason }, user.id);
    return NextResponse.json({ message: 'Due date extended.', loan });
  } catch (error) {
    return pawnErrorResponse(error, 'Extend pawn loan error', request);
  }
}
