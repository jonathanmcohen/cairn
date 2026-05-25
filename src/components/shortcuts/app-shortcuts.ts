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
}
