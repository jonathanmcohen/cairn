import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/**
 * v0.9.0 G1 P8 — per-workspace MFA enrollment policy.
 *
 * `requireMfa = false` (default) keeps the v0.6 P19 status quo: members may
 * enroll TOTP voluntarily, sign-in works either way. Flipping it true blocks
 * sign-in for members who have NO enrolled method in `methods`.
 *
 * `methods` is the union of acceptable methods. Defaults to the full set so
 * an admin who enables enforcement without restricting methods accepts
 * either TOTP or WebAuthn. The enforcement helper treats an empty array as
 * equivalent to the default (defense-in-depth; not normally writable).
 */
export const workspaceMfaPolicies = pgTable('workspace_mfa_policies', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  requireMfa: boolean('require_mfa').notNull().default(false),
  methods: text('methods').array().notNull().default(['totp', 'webauthn']),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkspaceMfaPolicy = typeof workspaceMfaPolicies.$inferSelect;
export type NewWorkspaceMfaPolicy = typeof workspaceMfaPolicies.$inferInsert;
