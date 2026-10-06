import { NextResponse } from 'next/server';
import { runInterestAccruals } from '@/lib/services/interest.js';
import { runPawnAccruals } from '@/lib/services/pawn.js';
import { logError } from '@/lib/logger.js';

// This loops through every active loan sequentially, each one doing a
// handful of DB writes inside its own transaction — with no maxDuration
// set, it inherited Vercel's default function timeout (10s on the Hobby
// plan). That's fine for a handful of loans but will get killed mid-run
// as the loan book grows past roughly a hundred+ active loans. 60s is the
// max allowed on Hobby; raise this (and your Vercel plan) if the loan
// book grows enough that even this isn't sufficient — the accrual catch-up
// logic means a timed-out run just finishes on the next day's cron
// without losing any interest, but it's better not to rely on that.
export const maxDuration = 60;

// Triggered by Vercel Cron (see vercel.json). Vercel automatically sends
// `Authorization: Bearer <CRON_SECRET>` on cron-triggered requests when the
// CRON_SECRET env var is set on the project, so this checks that instead of
// a user JWT — there's no logged-in user for a scheduled job to authenticate as.
export async function GET(request) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const results = await runInterestAccruals();
    // Pawn loans accrue on the same schedule; a failure there must not hide the cash-loan results.
    const pawnResults = await runPawnAccruals().catch((err) => {
      logError('Cron pawn accrual error', err, { method: request.method, url: request.url });
      return [{ status: 'error', error: err.message }];
    });
    return NextResponse.json({ message: 'Scheduled interest accrual completed.', results, pawnResults });
  } catch (error) {
    logError('Cron interest accrual error', error, { method: request.method, url: request.url });
    return NextResponse.json({ message: 'Interest accrual engine execution failed.' }, { status: 500 });
  }
}
