/**
 * v0.10.0 E6 — single consolidated page toolbar (polish-audit row 5).
 *
 * The page-detail route renders ONE action bar (icon/title/status/backlinks/
 * mode-toggles/panels/menu) and reserves an empty slot element carrying this
 * id as the bar's last child. <Editor> — a client component that hydrates
 * later — portals its control group (suggest/bibliography/presence/Live/
 * outline) into the slot, so both control sets share a single toolbar row
 * WITHOUT lifting any editor state out of editor.tsx.
 *
 * This constant lives in its own module (no 'use client' directive) so the
 * server component `pages/[pageId]/page.tsx` can import the plain string —
 * importing it from editor.tsx would hand the server a client-reference
 * proxy, not a string.
 */
export const EDITOR_TOOLBAR_SLOT_ID = 'cairn-editor-toolbar-slot';
