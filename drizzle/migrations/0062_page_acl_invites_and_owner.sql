-- 0062 — per-page ACL UI (#259): stored 'owner' tier + email invites.

-- A) Lock page_acls.permission to the closed set, now including 'owner'.
ALTER TABLE "page_acls"
  ADD CONSTRAINT "page_acls_permission_check"
  CHECK ("permission" IN ('view', 'comment', 'edit', 'owner'));

-- B) Email invitations to grant page access to not-yet-members.
CREATE TABLE "page_acl_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "email" text NOT NULL,
  "permission" text NOT NULL,
  "token" text NOT NULL,
  "invited_by" uuid NOT NULL,
  "accepted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL
);

ALTER TABLE "page_acl_invites"
  ADD CONSTRAINT "page_acl_invites_page_id_fk"
  FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade;
ALTER TABLE "page_acl_invites"
  ADD CONSTRAINT "page_acl_invites_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;
ALTER TABLE "page_acl_invites"
  ADD CONSTRAINT "page_acl_invites_invited_by_fk"
  FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE cascade;
ALTER TABLE "page_acl_invites"
  ADD CONSTRAINT "page_acl_invites_permission_check"
  CHECK ("permission" IN ('view', 'comment', 'edit', 'owner'));

CREATE UNIQUE INDEX "page_acl_invites_token_unique" ON "page_acl_invites" ("token");
-- One live (un-accepted) invite per (page,email): partial unique index.
CREATE UNIQUE INDEX "page_acl_invites_page_email_pending_unique"
  ON "page_acl_invites" ("page_id", lower("email"))
  WHERE "accepted_at" IS NULL;
CREATE INDEX "page_acl_invites_page_idx" ON "page_acl_invites" ("page_id");
