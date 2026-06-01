import type { Route } from 'next';
import { E2EEnrollCard } from '@/components/security/e2e-enroll-card';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { requireRole } from '@/lib/auth/require-role';
import { env } from '@/lib/env';

/**
 * v0.9.7 G21 (#168) — Security → Encryption settings page.
 *
 * Server Component gated by `requireRole('viewer')` + the build-time
 * NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION flag. Renders the self-service
 * E2E key enrollment card. The card handles the flag-off disabled message
 * via `enabled={false}` so all user-facing copy stays in the i18n catalog.
 */
export default async function SecurityEncryptionPage() {
  await requireRole('viewer');
  const flagOn = env().NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION;
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <SettingsBreadcrumb
        section={{ label: 'Security', href: '/settings/security' as Route }}
        page="Encryption"
      />
      <E2EEnrollCard enabled={flagOn} />
    </main>
  );
}
