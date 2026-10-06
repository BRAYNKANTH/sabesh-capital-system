import { NextResponse } from 'next/server';
import { requirePawnAdmin, pawnErrorResponse } from '@/lib/pawnApi.js';
import { forfeitPawnLoan } from '@/lib/services/pawn.js';

export async function POST(request, { params }) {
  try {
    const user = await requirePawnAdmin(request);
    const { reason, auction_proceeds, allow_early } = await request.json();
    const loan = await forfeitPawnLoan({ loanId: params.id, reason, auctionProceeds: auction_proceeds, allowEarly: !!allow_early }, user.id);
    return NextResponse.json({ message: 'Pawn loan forfeited.', loan });
  } catch (error) {
    return pawnErrorResponse(error, 'Forfeit pawn loan error', request);
  }
}
