'use client';

import { ForwarderForm } from '@/app/(app)/admin/siem/forwarder-form';
import { useT } from '@/lib/i18n/provider';

export type ForwarderRow = {
  id: string;
  kind: string;
  name: string;
  endpoint: string;
  enabled: boolean;
};

// Client view for the SIEM-forwarder settings page. The parent RSC fetches the
// forwarder rows and gates on requireRole('admin'); this renders the i18n copy
// (RSCs cannot call the useT() hook) and embeds the existing <ForwarderForm/>.
export function ForwardersView({ forwarders }: { forwarders: ForwarderRow[] }) {
  const t = useT();
  return (
    <>
      <header>
        <h1 className="text-xl font-semibold">{t('settingsAdmin.siem.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('settingsAdmin.siem.description')}</p>
      </header>

      <section aria-labelledby="forwarders-list" className="space-y-4">
        <h2 id="forwarders-list" className="text-lg font-medium">
          {t('settingsAdmin.siem.configured')}
        </h2>
        {forwarders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('settingsAdmin.siem.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {forwarders.map((f) => (
              <li
                key={f.id}
                className="rounded-md border p-4 text-sm"
                data-testid="siem-forwarder-row"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      {f.name} <span className="text-muted-foreground text-xs">({f.kind})</span>
                    </div>
                    <div className="text-muted-foreground text-xs">{f.endpoint}</div>
                  </div>
                  <div className="text-xs">
                    {f.enabled ? (
                      <span className="rounded bg-green-100 px-2 py-1 text-green-800 dark:bg-green-900 dark:text-green-100">
                        {t('settingsAdmin.siem.enabled')}
                      </span>
                    ) : (
                      <span className="rounded bg-muted px-2 py-1">
                        {t('settingsAdmin.siem.disabled')}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-forwarder" className="space-y-4">
        <h2 id="add-forwarder" className="text-lg font-medium">
          {t('settingsAdmin.siem.add')}
        </h2>
        <ForwarderForm />
      </section>
    </>
  );
}
