import { NextResponse } from 'next/server';
import { requirePawnAdmin, pawnErrorResponse } from '@/lib/pawnApi.js';
import { recordPawnPayment } from '@/lib/services/pawn.js';

export async function POST(request, { params }) {
  try {
    const user = await requirePawnAdmin(request);
    const body = await request.json();
    const result = await recordPawnPayment({
      loanId: params.id,
      amount: body.amount,
      paymentType: body.payment_type,
      notes: body.notes,
      paymentMethod: body.payment_method,
      idempotencyKey: body.idempotency_key,
      paymentDate: body.payment_date
    }, user.id);
    return NextResponse.json({
      message: result.redeemed ? 'Payment recorded. The loan is now fully paid — the item can be returned.' : 'Payment recorded.',
      payment: result.payment,
      loan: result.loan,
      redeemed: result.redeemed
    }, { status: 201 });
  } catch (error) {
    return pawnErrorResponse(error, 'Pawn payment error', request);
  }
}
