import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { users } from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { sendTestEmail } from '@/lib/email/config';

/**
 * POST /api/admin/email-config/test — send a test email to the caller's own
 * address using the effective config. Surfaces the SMTP error verbatim so the
 * admin can act; does NOT mark the config healthy on failure.
 */
export async function POST(): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const [user] = await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    if (!user?.email) {
      return NextResponse.json({ ok: false, error: 'no_recipient' }, { status: 400 });
    }
    const result = await sendTestEmail(getDb(), user.email);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
