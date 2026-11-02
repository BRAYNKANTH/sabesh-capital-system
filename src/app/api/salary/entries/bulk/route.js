import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { addAllEmployeesForMonth } from '@/lib/services/salary.js';

// Start of month: add a row (with the saved basic salary) for every employee who has none yet.
// Body: { month: '2026-11' }
export async function POST(request) {
  try {
    const user = await requireSalaryAdmin(request);
    const { month } = await request.json();
    return NextResponse.json(await addAllEmployeesForMonth(month, user.id), { status: 201 });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary month rows error', request);
  }
}
