import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { listEntries, createEntry } from '@/lib/services/salary.js';

// The table's rows: GET ?month=2026-11&agent_id=&type_id=
export async function GET(request) {
  try {
    await requireSalaryAdmin(request);
    const { searchParams } = new URL(request.url);
    return NextResponse.json(await listEntries({
      month: searchParams.get('month') || '',
      agentId: searchParams.get('agent_id') || '',
      typeId: searchParams.get('type_id') || ''
    }));
  } catch (error) {
    return salaryErrorResponse(error, 'Salary list error', request);
  }
}

// Add a row: { entry_date, agent_id, basic_salary, allowance_type_id, allowance_amount, deduction, note }
export async function POST(request) {
  try {
    const user = await requireSalaryAdmin(request);
    return NextResponse.json({ entry: await createEntry(await request.json(), user.id) }, { status: 201 });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary add error', request);
  }
}
