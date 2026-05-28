import { and, desc, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { auth } from '@/lib/auth/config';
import { mintPat } from '@/lib/auth/pat';

// Closed scope vocabulary from spec §3 G1.
const SCOPES = [
  'pages:read',
  'pages:write',
  'pages:destructive',
  'databases:read',
  'databases:write',
  'databases:destructive',
  'comments:read',
  'comments:write',
  'comments:destructive',
  'files:read',
  'files:write',
  'files:destructive',
  'mcp:read',
  'mcp:write',
  'mcp:destructive',
  'admin',
] as const;

const MintSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(SCOPES)).min(1),
  mcpTools: z.array(z.string().min(1).max(120)).default([]),
  expiresInDays: z.number().int().positive().max(365).optional(),
  // v0.9.0 G1 P9 — optional quotas. Omit/null = no cap.
  dailyRequestLimit: z.number().int().positive().max(10_000_000).nullable().optional(),
  monthlyRequestLimit: z.number().int().positive().max(100_000_000).nullable().optional(),
  scopeRateLimits: z
    .record(
      z.string().min(1).max(120),
      z.object({ perMinute: z.number().int().positive().max(10_000) }),
    )
    .nullable()
    .optional(),
});

/** Active workspace cookie set by the workspace-switcher; mirrors v0.6 admin routes. */
async function getActiveWorkspaceId(userId: string): Promise<string | null> {
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  const cookieWs = jar.get('cairn_ws')?.value;
  const db = getDb();
  if (cookieWs) {
    // Confirm the user is a member of the cookie's workspace.
    const [m] = await db
      .select({ id: schema.workspaceMembers.workspaceId })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.userId, userId),
          eq(schema.workspaceMembers.workspaceId, cookieWs),
        ),
      )
      .limit(1);
    if (m) return m.id;
  }
  // Fallback: first workspace the user is a member of.
  const [first] = await db
    .select({ id: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId))
    .limit(1);
  return first?.id ?? null;
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  // Never select tokenHash — the plaintext is unrecoverable by design.
  const rows = await getDb()
    .select({
      id: schema.personalAccessTokens.id,
      name: schema.personalAccessTokens.name,
      tokenPrefix: schema.personalAccessTokens.tokenPrefix,
      scopes: schema.personalAccessTokens.scopes,
      mcpTools: schema.personalAccessTokens.mcpTools,
      lastUsedAt: schema.personalAccessTokens.lastUsedAt,
      expiresAt: schema.personalAccessTokens.expiresAt,
      createdAt: schema.personalAccessTokens.createdAt,
    })
    .from(schema.personalAccessTokens)
    .where(
      and(
        eq(schema.personalAccessTokens.userId, session.user.id),
        isNull(schema.personalAccessTokens.revokedAt),
      ),
    )
    .orderBy(desc(schema.personalAccessTokens.createdAt));
  return NextResponse.json({
    tokens: rows.map((r) => ({
      id: r.id,
      name: r.name,
      tokenPrefix: r.tokenPrefix,
      scopes: r.scopes,
      mcpTools: r.mcpTools,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const parsed = MintSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation', issues: parsed.error.issues }, { status: 400 });
  }
  const workspaceId = await getActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'no_active_workspace' }, { status: 400 });
  }
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
    : null;
  const { token, row } = await mintPat(getDb(), {
    userId: session.user.id,
    workspaceId,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    mcpTools: parsed.data.mcpTools,
    expiresAt,
    dailyRequestLimit: parsed.data.dailyRequestLimit ?? null,
    monthlyRequestLimit: parsed.data.monthlyRequestLimit ?? null,
    scopeRateLimits: parsed.data.scopeRateLimits ?? null,
  });
  // Plaintext token returned ONCE; never persisted/retrievable after this response.
  return NextResponse.json(
    {
      token,
      row: {
        id: row.id,
        name: row.name,
        tokenPrefix: row.tokenPrefix,
        scopes: row.scopes,
        mcpTools: row.mcpTools,
        lastUsedAt: null,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
