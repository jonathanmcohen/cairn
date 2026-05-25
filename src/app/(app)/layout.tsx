import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LiveRegionProvider } from '@/components/a11y/live-region';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { NoWorkspace } from '@/components/no-workspace';
import { NotificationBell } from '@/components/notifications/bell';
import { OnboardingWizard } from '@/components/onboarding/wizard';
import { OfflineProvider } from '@/components/pwa/offline-context';
import { OfflineIndicator } from '@/components/pwa/offline-indicator';
import { RegisterSw } from '@/components/pwa/register-sw';
import { QuickCaptureModal } from '@/components/quick-capture/modal';
import { SearchPalette } from '@/components/search-palette';
import { ShortcutDispatcher } from '@/components/shortcuts/dispatcher';
import { ShortcutSheet } from '@/components/shortcuts/sheet';
import { Sidebar } from '@/components/sidebar';
import { SidebarContent } from '@/components/sidebar-content';
import { SidebarDrawer } from '@/components/sidebar-drawer';
import { SkipLink } from '@/components/skip-link';
import { ThemeProvider as UserThemeProvider } from '@/components/themes/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { isTwoFactorEnabled, userHasWorkspaceRequiring2fa } from '@/lib/auth/two-factor';
import { getOnboardingState } from '@/lib/onboarding/state';
import { getThemePrefs } from '@/lib/themes/prefs';
import { listUserWorkspaces } from '@/lib/workspaces/list';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  if (!ctx.workspaceId) {
    return <NoWorkspace />;
  }
  // require_2fa enforcement: if any of this user's workspaces requires 2FA and
  // the user has no enabled TOTP, force enrollment. Exempt the security page
  // itself (where they enroll) to avoid a redirect loop; proxy.ts already
  // exempts /api/* and the auth pages. Pathname comes from proxy.ts via
  // x-pathname (server components don't see request URLs natively).
  const pathname = (await headers()).get('x-pathname') ?? '';
  const onSecurityPage = pathname.startsWith('/settings/security');
  if (!onSecurityPage) {
    const db = getDb();
    const mustEnroll =
      (await userHasWorkspaceRequiring2fa(db, ctx.userId)) &&
      !(await isTwoFactorEnabled(db, ctx.userId));
    if (mustEnroll) {
      redirect('/settings/security?enroll=required');
    }
  }
  const workspaces = await listUserWorkspaces(getDb(), ctx.userId);
  const onboardingState = await getOnboardingState(getDb(), {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
  const themePrefs = await getThemePrefs(getDb(), ctx.userId);
  return (
    <UserThemeProvider initialPrefs={themePrefs}>
      <OfflineProvider>
        <LiveRegionProvider>
          <ShortcutDispatcher>
            <SkipLink />
            <div className="flex min-h-screen flex-col md:flex-row">
              <RegisterSw />
              <SearchPalette currentUserId={ctx.userId} />
              <ShortcutSheet />
              <QuickCaptureModal />
              <OnboardingWizard workspaceId={ctx.workspaceId} initialState={onboardingState} />
              <Sidebar workspaceId={ctx.workspaceId} />
              <SidebarDrawer>
                <SidebarContent workspaceId={ctx.workspaceId} workspaces={workspaces} />
              </SidebarDrawer>
              <main id="main-content" className="flex-1 p-8">
                <div className="mb-2 flex items-center justify-end gap-4">
                  <NotificationBell />
                  <LocaleSwitcher />
                  <OfflineIndicator />
                </div>
                {children}
              </main>
              <Toaster />
            </div>
          </ShortcutDispatcher>
        </LiveRegionProvider>
      </OfflineProvider>
    </UserThemeProvider>
  );
}
