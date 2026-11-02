import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { updateEntry, setPaid, deleteEntry } from '@/lib/services/salary.js';

// Change fields of a row, or mark it paid / undo with { paid: true | false }.
export async function PATCH(request, { params }) {
  try {
    const user = await requireSalaryAdmin(request);
    const body = await request.json();
    const entry = 'paid' in body ? await setPaid(params.id, !!body.paid, user.id) : await updateEntry(params.id, body, user.id);
    return NextResponse.json({ entry });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary edit error', request);
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await requireSalaryAdmin(request);
    await deleteEntry(params.id, user.id);
    return NextResponse.json({ message: 'Row deleted.' });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary delete error', request);
  }
}
