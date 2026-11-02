import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { listTypes, createType } from '@/lib/services/salary.js';

export async function GET(request) {
  try {
    await requireSalaryAdmin(request);
    return NextResponse.json(await listTypes());
  } catch (error) {
    return salaryErrorResponse(error, 'Salary types error', request);
  }
}

// Add an allowance type: { name }
export async function POST(request) {
  try {
    const user = await requireSalaryAdmin(request);
    const { name } = await request.json();
    return NextResponse.json(await createType(name, user.id), { status: 201 });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary type create error', request);
  }
}
