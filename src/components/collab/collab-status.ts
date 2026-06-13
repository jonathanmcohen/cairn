import type { CollabStatus } from '@/components/editor/use-collab-doc';

/**
 * v0.10.2 S14 — single source of truth for the collab status-pill presentation,
 * shared by the page-header pill (editor.tsx) and the sidebar-footer pill
 * (sidebar-footer-nav.tsx). Keeping the dot-color map and the i18n label-key map
 * here means the two pills can never drift (DRY).
 */

// a30 #39 — status-pill dot color per collab connection state. Tailwind class
// strings (not dynamic) so the JIT compiler keeps them.
export const STATUS_DOT: Record<CollabStatus, string> = {
  connecting: 'bg-warning',
  connected: 'bg-success',
  disconnected: 'bg-warning',
  error: 'bg-destructive',
};

// v0.10.2 S14 — i18n message keys for each collab connection state. The en
// values are byte-identical to the previous hardcoded STATUS_LABEL literals
// ("Connecting…"/"Live"/"Reconnecting…"/"Offline"), so the rendered en text —
// including the existing `title="Live"` e2e hook — is unchanged.
export const STATUS_LABEL_KEY: Record<CollabStatus, string> = {
  connecting: 'collab.status.connecting',
  connected: 'collab.status.connected',
  disconnected: 'collab.status.disconnected',
  error: 'collab.status.error',
};
