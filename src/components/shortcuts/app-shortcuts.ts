import { openQuickCapture } from '@/components/quick-capture/controller';
import { toggleSidebarCollapsed } from '@/components/sidebar-collapse';
import { registerShortcut } from '@/lib/shortcuts/registry';

export type ShortcutHandlers = {
  newPage: () => void;
  toggleTheme: () => void;
  switchWorkspace: () => void;
  openFavorites: () => void;
  openSheet: () => void;
  export: () => void;
};

let handlers: ShortcutHandlers | null = null;
let registered = false;

export function setShortcutHandlers(h: ShortcutHandlers): void {
  handlers = h;
}

/** Test-only: clear the memoization flag so `ensureAppShortcuts` re-registers
 *  after `resetRegistry()` in a fresh test. */
export function __resetRegistered(): void {
  registered = false;
}

export function ensureAppShortcuts(): void {
  if (registered) return;
  registered = true;

  registerShortcut({
    id: 'page.new',
    keys: 'Mod+N',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.newPage',
    run: () => {
      handlers?.newPage();
    },
  });

  registerShortcut({
    id: 'theme.toggle',
    keys: 'Mod+Shift+L',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.toggleTheme',
    run: () => {
      handlers?.toggleTheme();
    },
  });

  registerShortcut({
    id: 'workspace.switch',
    keys: 'Mod+Shift+O',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.switchWorkspace',
    run: () => {
      handlers?.switchWorkspace();
    },
  });

  registerShortcut({
    id: 'nav.favorites',
    keys: 'Mod+Shift+F',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.openFavorites',
    run: () => {
      handlers?.openFavorites();
    },
  });

  // v0.9.9 Plan N #61/#240 — global export shortcut. Mod+Shift+E was unused in
  // the 'global' scope (existing: Mod+N, Mod+Shift+L/O/F/N, Mod+/). The `run`
  // delegates to the dispatcher handler, which fires a `cairn:export:open`
  // window event the action-bar Export menu listens for.
  registerShortcut({
    id: 'export.page',
    keys: 'Mod+Shift+E',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.export',
    run: () => {
      handlers?.export();
    },
  });

  // v0.10.2 S1 — sidebar collapse toggle. Mod+\ was unused in the 'global'
  // scope. The handler is a module-level function (like openQuickCapture), so
  // no dispatcher handler plumbing is needed; it flips the
  // `cairn-sidebar-collapsed` root class + `cairn:sidebar-collapsed`
  // localStorage flag and never touches the persisted resize width.
  registerShortcut({
    id: 'sidebar.toggle',
    keys: 'Mod+\\',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.toggleSidebar',
    run: toggleSidebarCollapsed,
  });

  registerShortcut({
    id: 'shortcuts.sheet',
    keys: 'Mod+/',
    scope: 'global',
    kind: 'command',
    labelKey: 'shortcut.openSheet',
    run: () => {
      handlers?.openSheet();
    },
  });

  // v0.10.0 Plan E E1 — bare `?` as a second binding for the shortcuts sheet.
  // A separate id because the registry replaces on id re-use and each entry
  // carries exactly one `keys` string; the SAME labelKey makes the ⌘/ sheet
  // render one row showing both triggers. No normalizeKeys collision:
  // '?' → '?' vs 'Mod+/' → 'mod+/' stay distinct entries. The dispatcher only
  // lets `?` through when focus is outside inputs/contenteditable.
  registerShortcut({
    id: 'shortcuts.sheet.bare',
    keys: '?',
    scope: 'global',
    kind: 'command',
    labelKey: 'shortcut.openSheet',
    run: () => {
      handlers?.openSheet();
    },
  });

  // v0.10.0 H4e — the labelKey was 'shortcuts.quickCapture', which exists in
  // no catalog ('shortcuts.*' is sheet chrome; row labels live under
  // 'shortcut.*'), so the ⌘/ sheet rendered the raw key string. Aligned with
  // the sibling rows + keyed in en/es/ar.
  registerShortcut({
    id: 'app.quickCapture',
    keys: 'Mod+Shift+N',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.quickCapture',
    run: openQuickCapture,
  });

  // v0.9.4 P29 #117 — editor-scoped insert-link shortcut. This is the first
  // entry in the previously-empty 'editor' scope, so it populates the ⌘/
  // shortcuts sheet's Editor group and documents ⌘⇧K. The actual keystroke is
  // handled by the TipTap EditorLinkShortcut extension (only meaningful with
  // editor focus); this `run` simply mirrors the open-link event so the palette
  // entry stays functional. No collision: 'editor' scope was empty, and a
  // different scope than the global Mod+Shift+L/O/F/N entries.
  registerShortcut({
    id: 'editor.insertLink',
    keys: 'Mod+Shift+K',
    scope: 'editor',
    kind: 'action',
    labelKey: 'shortcut.insertLink',
    run: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cairn:editor:open-link'));
      }
    },
  });

  // v0.9.9 Plan O #57/#236 — page focus/reader toggle shortcuts. The toggle
  // buttons live in the page header (outside the dispatcher tree and, in focus
  // mode, hidden by CSS), so each `run` dispatches a window CustomEvent the
  // <PageModeShell> listens for (same pattern as editor.insertLink). Mod+Shift+.
  // and Mod+Shift+R are unused in the 'global' scope.
  registerShortcut({
    id: 'page.focus',
    keys: 'Mod+Shift+.',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.focusMode',
    run: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cairn:page-mode:toggle-focus'));
      }
    },
  });

  registerShortcut({
    id: 'page.reader',
    keys: 'Mod+Shift+R',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.readerMode',
    run: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cairn:page-mode:toggle-reader'));
      }
    },
  });

  // v0.9.4 P26 #108 — document the two editor suggestion triggers in the ⌘/
  // shortcuts sheet so the `@` (people) vs `[[`/`@@` (pages) split is
  // discoverable. These are typed-character triggers, not keystroke handlers,
  // so `run` is a no-op (the actual behavior lives in the TipTap suggestion
  // plugins); they appear purely as documentation rows. `keys` carries the
  // literal trigger glyphs (no `+`, so they never collide with the modifier
  // shortcuts in this scope).
  registerShortcut({
    id: 'editor.mentionPerson',
    keys: '@',
    scope: 'editor',
    kind: 'command',
    labelKey: 'shortcut.mentionPerson',
    run: () => {},
  });

  registerShortcut({
    id: 'editor.linkPage',
    keys: '[[',
    scope: 'editor',
    kind: 'command',
    labelKey: 'shortcut.linkPage',
    run: () => {},
  });
}
