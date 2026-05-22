import { redirect } from 'next/navigation';
import { NotificationPrefs } from '@/components/settings/notification-prefs';
import { getAuthContext } from '@/lib/auth/require-role';

export default async function NotificationSettingsPage() {
  const ctx = await getAuthContext();
  // Per-user, workspace-scoped preferences — any member may manage their own.
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-3xl font-semibold">Notifications</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Choose how you&apos;re notified per event type in this workspace. In-app notifications
        always appear in your inbox; email delivery requires a configured SMTP server.
      </p>
      <NotificationPrefs />
    </div>
  );
}
