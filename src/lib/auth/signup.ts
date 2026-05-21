import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '@/db/schema';
import { hashPassword } from './password';

export const SignupInput = z.object({
  email: z.email(),
  password: z.string().min(12),
  name: z.string().min(1),
  workspaceName: z.string().min(1).optional(),
  inviteToken: z.string().optional(),
});

export type SignupInputT = z.infer<typeof SignupInput>;

export type SignupResult = {
  userId: string;
  workspaceId: string;
  role: schema.MemberRole;
};

export async function signup(
  db: PostgresJsDatabase<typeof schema>,
  input: SignupInputT,
): Promise<SignupResult> {
  const parsed = SignupInput.parse(input);

  return db.transaction(async (tx) => {
    const [existingWs] = await tx
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .limit(1);
    let workspaceId: string;
    let role: schema.MemberRole;

    if (!existingWs) {
      // Bootstrap path
      if (!parsed.workspaceName) {
        throw new Error('First signup must include workspaceName');
      }
      const slug = slugify(parsed.workspaceName);
      const [ws] = await tx
        .insert(schema.workspaces)
        .values({ name: parsed.workspaceName, slug })
        .returning();
      if (!ws) throw new Error('Failed to create workspace');
      workspaceId = ws.id;
      role = 'owner';
    } else {
      // Invited path
      if (!parsed.inviteToken) {
        throw new Error('An invite token is required to sign up to this workspace');
      }
      const [token] = await tx
        .select()
        .from(schema.inviteTokens)
        .where(eq(schema.inviteTokens.token, parsed.inviteToken))
        .limit(1);
      if (!token) throw new Error('Invalid invite token');
      if (token.usedAt) throw new Error('Invite token already used');
      if (token.expiresAt < new Date()) throw new Error('Invite token has expired');
      if (token.email.toLowerCase() !== parsed.email.toLowerCase()) {
        throw new Error('Invite token email does not match signup email');
      }
      workspaceId = token.workspaceId;
      role = token.role;

      await tx
        .update(schema.inviteTokens)
        .set({ usedAt: new Date() })
        .where(eq(schema.inviteTokens.id, token.id));
    }

    const passwordHash = await hashPassword(parsed.password);
    const [user] = await tx
      .insert(schema.users)
      .values({ email: parsed.email.toLowerCase(), passwordHash, name: parsed.name })
      .returning();
    if (!user) throw new Error('Failed to create user');

    await tx.insert(schema.workspaceMembers).values({ workspaceId, userId: user.id, role });

    return { userId: user.id, workspaceId, role };
  });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
