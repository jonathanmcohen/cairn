# End-to-end encryption (E2EE)

Cairn ships with end-to-end encryption **disabled by default** for safety:
enabling it changes how every page in a workspace is stored and is reversible
only by restoring from backup.

## Default

- `CAIRN_ENABLE_E2E_ENCRYPTION=false` (server guard)
- `NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=false` (build-time UI mirror)

With the flag off, the admin **Workspace encryption** page shows an explanation
instead of the toggle, and the per-page **Encrypt page** action is hidden.

## Enabling

1. Set BOTH env vars to `true`:
   ```
   CAIRN_ENABLE_E2E_ENCRYPTION=true
   NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=true
   ```
   The `NEXT_PUBLIC_` mirror is inlined at build time, so a **rebuild** (not just
   a restart) is required.
2. Redeploy from a freshly built image (`ghcr.io/jonathanmcohen/cairn:v0.9.8`).
3. Each member enrolls a keypair (Settings → Security → Encryption): a passphrase
   seals an X25519 private key client-side; the server only ever stores the
   sealed blob and the public key.
4. Admins can then turn on per-page encryption or flip the workspace to
   `workspace_wide` mode under Settings → Admin → Encryption.

## How it works (no plaintext on the server)

- Per-user X25519 keypair, private key sealed under a scrypt-derived KEK.
- Per-page DEK (AES-256-GCM) wrapped to each member's public key.
- Workspace-wide mode wraps a single workspace key (WSK) per member.
- **Rekey / member removal** mints a new WSK, re-wraps it for the remaining
  roster, and re-encrypts every page — the removed member's cached old key
  cannot read the new ciphertext.

## Caveats

- **Lockout risk:** a lost passphrase with no other enrolled device strands that
  member's access. Keep the workspace roster > 1 enrolled member.
- **Search:** encrypted page bodies are not full-text searchable server-side.
- This release does **not** change the default; encryption stays opt-in.
