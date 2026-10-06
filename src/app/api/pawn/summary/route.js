import { NextResponse } from 'next/server';
import { requirePawnAdmin, pawnErrorResponse } from '@/lib/pawnApi.js';
import { getPawnSummary } from '@/lib/services/pawn.js';

export async function GET(request) {
  try {
    await requirePawnAdmin(request);
    return NextResponse.json(await getPawnSummary());
  } catch (error) {
    return pawnErrorResponse(error, 'Pawn summary error', request);
  }
}
