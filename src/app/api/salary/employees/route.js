import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { listEmployees } from '@/lib/services/salary.js';

// Everyone who can be paid, with their saved basic salary and bank details.
export async function GET(request) {
  try {
    await requireSalaryAdmin(request);
    return NextResponse.json(await listEmployees());
  } catch (error) {
    return salaryErrorResponse(error, 'Salary employees error', request);
  }
}
