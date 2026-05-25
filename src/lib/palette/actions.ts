/**
 * Palette action catalog. The single source of truth for every command the
 * cmdk palette can invoke. Each entry takes a PaletteContext (router, current
 * page id, theme setter, etc.) and exposes a `run()` that performs the action.
 *
 * The v0.6 P15 shortcut registry (`src/lib/shortcuts/registry.ts`) remains
 * the source of truth for keyboard bindings; an entry here that has a hotkey
 * also lists the same `shortcutKey` string for display next to the row.
 *
 * Context-gated entries (e.g. `page.copyLink`) are omitted from the returned
 * list when the required context isn't present — the palette never shows a
 * "page action" while the user is on a route without a current page.
 */

export type PaletteRouter = {
  push: (path: string) => void;
  refresh: () => void;
};

export type PaletteContext = {
  router: PaletteRouter;
  currentPageId: string | null;
  currentUserId: string;
  setTheme: (theme: 'light' | 'dark') => void;
  currentTheme: 'light' | 'dark' | 'system';
  toast: (message: string) => void;
  /** Opens the global notification drawer (G6 P15). No-ops if the drawer hasn't been mounted yet. */
  openNotifications: () => void;
};

export type PaletteAction = {
  id: string;
  label: string;
  /** Display string like "Cmd+K" — shown as a hotkey hint on the palette row. */
  shortcutKey?: string;
  run: () => void;
};

function copyToClipboard(text: string, toast: (m: string) => void): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    toast('Copy not supported in this browser.');
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => toast('Link copied to clipboard'),
    () => toast('Copy failed'),
  );
}

export function buildPaletteActions(ctx: PaletteContext): PaletteAction[] {
  const actions: PaletteAction[] = [
    {
      id: 'nav.home',
      label: 'Go to home',
      run: () => ctx.router.push('/'),
    },
    {
      id: 'nav.inbox',
      label: 'Open inbox',
      run: () => ctx.router.push('/inbox'),
    },
    {
      id: 'nav.notifications',
      label: 'Open notifications',
      run: () => ctx.router.push('/notifications'),
    },
    {
      id: 'nav.favorites',
      label: 'Open favorites',
      shortcutKey: 'Mod+Shift+F',
      run: () => ctx.router.push('/favorites'),
    },
    {
      id: 'nav.templates',
      label: 'Open templates gallery',
      run: () => ctx.router.push('/templates'),
    },
    {
      id: 'nav.settings.account',
      label: 'Settings: Account',
      run: () => ctx.router.push('/settings/account'),
    },
    {
      id: 'nav.settings.workspace',
      label: 'Settings: Workspace',
      run: () => ctx.router.push('/settings/workspace'),
    },
    {
      id: 'nav.settings.security',
      label: 'Settings: Security',
      run: () => ctx.router.push('/settings/security'),
    },
    {
      id: 'nav.settings.developer',
      label: 'Settings: Developer',
      run: () => ctx.router.push('/settings/developer'),
    },
    {
      id: 'nav.settings.notifications',
      label: 'Settings: Notifications',
      run: () => ctx.router.push('/settings/notifications'),
    },
    {
      id: 'page.new',
      label: 'Create new page',
      shortcutKey: 'Mod+N',
      run: () => ctx.router.push('/pages/new'),
    },
    {
      id: 'search.open',
      label: 'Search across workspace',
      shortcutKey: 'Mod+K',
      run: () => {
        // The palette is already open when an action runs from it; this is a
        // no-op alias so the action shows in the catalog (and Recent group)
        // for keyboard users who reach it via cmdk's filtering.
      },
    },
    {
      id: 'theme.toggle',
      label: 'Toggle light/dark theme',
      shortcutKey: 'Mod+Shift+L',
      run: () => {
        const next = ctx.currentTheme === 'dark' ? 'light' : 'dark';
        ctx.setTheme(next);
      },
    },
    {
      id: 'workspace.switch',
      label: 'Switch workspace',
      shortcutKey: 'Mod+Shift+O',
      run: () => ctx.router.push('/workspaces'),
    },
    {
      id: 'auth.signout',
      label: 'Sign out',
      run: () => {
        void fetch('/api/auth/signout', { method: 'POST' }).finally(() => {
          ctx.router.push('/login');
        });
      },
    },
  ];

  if (ctx.currentPageId) {
    const pageId = ctx.currentPageId;
    actions.push(
      {
        id: 'page.copyLink',
        label: 'Copy link to current page',
        run: () => {
          const origin =
            typeof window !== 'undefined' && window.location ? window.location.origin : '';
          copyToClipboard(`${origin}/pages/${pageId}`, ctx.toast);
        },
      },
      {
        id: 'page.exportPdf',
        label: 'Export current page as PDF',
        run: () => {
          if (typeof window !== 'undefined') {
            window.open(`/api/pages/${pageId}/export?format=pdf`, '_blank');
          }
        },
      },
    );
  }

  return actions;
}
