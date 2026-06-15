import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { EmailConfigForm } from '@/components/settings/email-config-form';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { getEmailConfigForDisplay } from '@/lib/email/config';

/**
 * v0.10.3 CFG-1 — admin-scoped instance email (SMTP) configuration page.
 *
 * Server Component. Gates on `requireRole('admin')`. Instance-global config:
 * DB row overrides `SMTP_*` env; the form never receives the stored password
 * (masked to a `passwordSet` flag).
 */
export default async function AdminEmailPage() {
  await requireRole('admin');
  const initial = await getEmailConfigForDisplay(getDb());

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Email"
      />
      <h1 className="mb-2 font-semibold text-xl">Email (SMTP)</h1>
      <p className="mb-4 text-muted-foreground text-sm">
        Instance-wide outgoing email server. These values override the SMTP_* environment variables
        once saved. The password is stored encrypted and never shown again.
      </p>
      <EmailConfigForm initial={initial} />
    </section>
  );
}
