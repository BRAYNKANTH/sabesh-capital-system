import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { deletePayment, markPaid } from '@/lib/services/salary.js';

// Marks a pending record as paid.
export async function PATCH(request, { params }) {
  try {
    const user = await requireSalaryAdmin(request);
    const { alreadyPaid } = await markPaid(params.id, user.id);
    return NextResponse.json({ message: alreadyPaid ? 'Already marked as paid.' : 'Marked as paid.' });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary mark-paid error', request);
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await requireSalaryAdmin(request);
    await deletePayment(params.id, user.id);
    return NextResponse.json({ message: 'Record deleted.' });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary delete error', request);
  }
}
