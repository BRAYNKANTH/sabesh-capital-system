import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { addAllowance } from '@/lib/services/salary.js';

// Add an allowance line to a row: { type_id, amount }
export async function POST(request, { params }) {
  try {
    const user = await requireSalaryAdmin(request);
    const entry = await addAllowance(params.id, await request.json(), user.id);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary allowance add error', request);
  }
}
