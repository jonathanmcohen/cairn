import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireRole, requireWorkspace } from '@/lib/auth/require-role';
import {
  FlashcardSettingsValidationError,
  getWorkspaceFlashcardSettings,
  upsertWorkspaceFlashcardSettings,
} from '@/lib/flashcards/settings';

/**
 * v0.10.2 F3 Task D — Flashcard workspace settings API.
 *
 * - GET:  Returns current settings (or defaults) for the active workspace.
 *         Any authenticated workspace member may read.
 * - PATCH: Validates and upserts settings. Requires admin-or-higher role
 *          (mirrors trash-settings' role gate). Range violations → 400.
 */
export async function GET(): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const settings = await getWorkspaceFlashcardSettings(getDb(), ctx.workspaceId);
    return NextResponse.json(settings);
  } catch (err) {
    return toErrorResponse(err);
  }
}

const PatchSchema = z.object({
  defaultDeckId: z.string().uuid().nullable().optional(),
  newPerDay: z.number().int().min(0).optional(),
  reviewLimit: z.number().int().min(0).optional(),
  easeStart: z.number().min(1.3).optional(),
  leechThreshold: z.number().int().min(1).optional(),
  reminderHour: z.number().int().min(0).max(23).nullable().optional(),
});

export async function PATCH(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const settings = await upsertWorkspaceFlashcardSettings(getDb(), ctx.workspaceId, parsed.data);
    return NextResponse.json(settings);
  } catch (err) {
    return toErrorResponse(err);
  }
}

function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof FlashcardSettingsValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    { status: 500 },
  );
}
