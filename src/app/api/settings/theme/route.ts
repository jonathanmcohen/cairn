import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { setThemePrefs } from '@/lib/themes/prefs';
import { ThemePrefsSchema } from '@/lib/themes/presets';

export const runtime = 'nodejs';

export async function PATCH(req: Request): Promise<Response> {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = ThemePrefsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid prefs', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await setThemePrefs(getDb(), ctx.userId, parsed.data);
  return NextResponse.json({ ok: true });
}
