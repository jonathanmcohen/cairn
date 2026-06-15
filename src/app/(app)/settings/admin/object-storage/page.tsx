import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { StorageConfigForm } from '@/components/settings/storage-config-form';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { getStorageConfigForDisplay } from '@/lib/files/storage-config';

/**
 * v0.10.3 CFG-2 — admin-scoped instance object-storage (S3) configuration page.
 *
 * Server Component. Gates on `requireRole('admin')`. Instance-global config:
 * DB row overrides `S3_*`/`FILE_BACKEND` env; the form never receives the
 * stored secret key (masked to a `secretKeySet` flag). Distinct from the
 * workspace storage-QUOTA page at /settings/admin/storage.
 */
export default async function AdminObjectStoragePage() {
  await requireRole('admin');
  const initial = await getStorageConfigForDisplay(getDb());

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="Object storage"
      />
      <h1 className="mb-2 font-semibold text-xl">Object storage (S3)</h1>
      <p className="mb-4 text-muted-foreground text-sm">
        Instance-wide S3-compatible object storage. These values override the S3_* / FILE_BACKEND
        environment variables once saved. The secret key is stored encrypted and never shown again.
        Each consumer stays disabled until you save a config and run a successful connection test.
      </p>
      <StorageConfigForm initial={initial} />
    </section>
  );
}
