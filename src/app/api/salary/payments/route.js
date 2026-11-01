import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { listPayments, recordPayment } from '@/lib/services/salary.js';

export async function GET(request) {
  try {
    await requireSalaryAdmin(request);
    const { searchParams } = new URL(request.url);
    return NextResponse.json(await listPayments({
      month: searchParams.get('month') || '',
      agentId: searchParams.get('agent_id') || '',
      typeId: searchParams.get('type_id') || '',
      status: searchParams.get('status') || '',
      kind: searchParams.get('kind') || ''
    }));
  } catch (error) {
    return salaryErrorResponse(error, 'Salary list error', request);
  }
}

export async function POST(request) {
  try {
    const user = await requireSalaryAdmin(request);
    const result = await recordPayment(await request.json(), user.id);
    const message = result.pending ? `Noted (${result.type_name}) — to be paid back.` : `Recorded (${result.type_name}).`;
    return NextResponse.json({ message, ...result }, { status: 201 });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary record error', request);
  }
}
