import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { updateAllowance, deleteAllowance } from '@/lib/services/salary.js';

// Change an allowance line's type or amount: { type_id?, amount? }
export async function PATCH(request, { params }) {
  try {
    const user = await requireSalaryAdmin(request);
    const entry = await updateAllowance(params.id, params.lineId, await request.json(), user.id);
    return NextResponse.json({ entry });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary allowance edit error', request);
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await requireSalaryAdmin(request);
    const entry = await deleteAllowance(params.id, params.lineId, user.id);
    return NextResponse.json({ entry });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary allowance remove error', request);
  }
}
