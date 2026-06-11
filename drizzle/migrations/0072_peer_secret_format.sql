-- 0072_peer_secret_format.sql
-- v0.10.0 G1 — encrypted-at-rest federated peer secrets.
--
-- Adds `peer_instances.secret_format` ('raw' | 'enc-v1', default 'raw') so the
-- verify path knows whether `shared_secret_hash` holds a legacy raw secret or
-- an enc-v1 AES-256-GCM envelope (src/lib/search/peer-secret.ts). Hand-written:
-- db:generate has no CHECK builder (the 0071 lesson).
--
-- NO data backfill ON PURPOSE: existing rows stay 'raw' and are lazily
-- re-encrypted by the inbound verify route after their first SUCCESSFUL verify
-- with CAIRN_PEER_SECRET_KEY set (no flag-day; keyless deployments keep
-- today's raw-at-rest behavior). The A3 backfill rule is satisfied by the
-- column default — every existing row's behavior is unchanged ('raw' is
-- exactly what the old code stored).
--
-- IDEMPOTENT by design (a spec re-applies this file to prove it):
-- ADD COLUMN IF NOT EXISTS + pg_constraint guard around the CHECK.
ALTER TABLE "peer_instances" ADD COLUMN IF NOT EXISTS "secret_format" text DEFAULT 'raw' NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'peer_instances_secret_format_check'
      AND conrelid = '"peer_instances"'::regclass
  ) THEN
    ALTER TABLE "peer_instances"
      ADD CONSTRAINT "peer_instances_secret_format_check"
      CHECK ("secret_format" IN ('raw','enc-v1'));
  END IF;
END $$;
