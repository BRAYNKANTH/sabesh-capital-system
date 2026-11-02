import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { updateEntry, deleteEntry } from '@/lib/services/salary.js';

// Change fields of a row.
export async function PATCH(request, { params }) {
  try {
    const user = await requireSalaryAdmin(request);
    const body = await request.json();
    const entry = await updateEntry(params.id, body, user.id);
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
