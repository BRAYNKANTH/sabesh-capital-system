import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { saveEmployeeDetails } from '@/lib/services/salary.js';

// Save an employee's details: { basic_salary, bank_name, bank_branch, account_holder, account_number }
export async function PUT(request, { params }) {
  try {
    const user = await requireSalaryAdmin(request);
    const employee = await saveEmployeeDetails(params.id, await request.json(), user.id);
    return NextResponse.json({ employee });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary employee save error', request);
  }
}
