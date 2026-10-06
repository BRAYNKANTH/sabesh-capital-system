import { NextResponse } from 'next/server';
import { requirePawnAdmin, pawnErrorResponse } from '@/lib/pawnApi.js';
import { createPawnLoan, listPawnLoans } from '@/lib/services/pawn.js';

export async function GET(request) {
  try {
    await requirePawnAdmin(request);
    const params = request.nextUrl.searchParams;
    const loans = await listPawnLoans({ status: params.get('status'), search: params.get('search') });
    return NextResponse.json(loans);
  } catch (error) {
    return pawnErrorResponse(error, 'List pawn loans error', request);
  }
}

export async function POST(request) {
  try {
    const user = await requirePawnAdmin(request);
    const body = await request.json();
    const loan = await createPawnLoan(body, user.id);
    return NextResponse.json({ message: 'Pawn loan created.', loan }, { status: 201 });
  } catch (error) {
    return pawnErrorResponse(error, 'Create pawn loan error', request);
  }
}
