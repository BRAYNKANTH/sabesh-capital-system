import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { deletePayment } from '@/lib/services/salary.js';

export async function DELETE(request, { params }) {
  try {
    const user = await requireSalaryAdmin(request);
    await deletePayment(params.id, user.id);
    return NextResponse.json({ message: 'Record deleted.' });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary delete error', request);
  }
}
