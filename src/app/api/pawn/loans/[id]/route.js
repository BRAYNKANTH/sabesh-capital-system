import { NextResponse } from 'next/server';
import { requirePawnAdmin, pawnErrorResponse } from '@/lib/pawnApi.js';
import { getPawnLoanDetail } from '@/lib/services/pawn.js';

export async function GET(request, { params }) {
  try {
    await requirePawnAdmin(request);
    return NextResponse.json(await getPawnLoanDetail(params.id));
  } catch (error) {
    return pawnErrorResponse(error, 'Get pawn loan error', request);
  }
}
