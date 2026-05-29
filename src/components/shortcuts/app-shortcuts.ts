import { openQuickCapture } from '@/components/quick-capture/controller';
import { registerShortcut } from '@/lib/shortcuts/registry';

export type ShortcutHandlers = {
  newPage: () => void;
  toggleTheme: () => void;
  switchWorkspace: () => void;
  openFavorites: () => void;
  openSheet: () => void;
};

let handlers: ShortcutHandlers | null = null;
let registered = false;

export function setShortcutHandlers(h: ShortcutHandlers): void {
  handlers = h;
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

  registerShortcut({
    id: 'app.quickCapture',
    keys: 'Mod+Shift+N',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcuts.quickCapture',
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
}
