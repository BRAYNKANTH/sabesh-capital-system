import { NextResponse } from 'next/server';
import { requireSalaryAdmin, salaryErrorResponse } from '@/lib/salaryApi.js';
import { getSheet, setCell, setPaid } from '@/lib/services/salary.js';

// The month's table: GET ?month=2026-11
export async function GET(request) {
  try {
    await requireSalaryAdmin(request);
    const { searchParams } = new URL(request.url);
    return NextResponse.json(await getSheet(searchParams.get('month')));
  } catch (error) {
    return salaryErrorResponse(error, 'Salary sheet error', request);
  }
}

// Edit one cell: { agent_id, month, type_id, amount }
export async function PUT(request) {
  try {
    const user = await requireSalaryAdmin(request);
    const b = await request.json();
    const row = await setCell({ agentId: b.agent_id, month: b.month, typeId: b.type_id, amount: b.amount }, user.id);
    return NextResponse.json({ row });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary cell error', request);
  }
}

// Mark a row paid / undo it: { agent_id, month, paid: true|false }
export async function PATCH(request) {
  try {
    const user = await requireSalaryAdmin(request);
    const b = await request.json();
    const row = await setPaid({ agentId: b.agent_id, month: b.month, paid: !!b.paid }, user.id);
    return NextResponse.json({ row });
  } catch (error) {
    return salaryErrorResponse(error, 'Salary paid error', request);
  }
}
