'use client';

import { LogOut, Monitor } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

type ApiSession = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

/**
 * #70 — active sessions list + "sign out everywhere else". Cairn keeps the
 * stateless jwt strategy but each login mints an `auth_sessions` row keyed by a
 * `sid` claim, so sessions are now enumerable (GET /api/auth/sessions) and
 * revocable (POST /api/auth/sessions/revoke-all). The current device is matched
 * server-side via the request's sid.
 */
export function SessionsCard() {
  const t = useT();
  const [sessions, setSessions] = useState<ApiSession[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch('/api/auth/sessions');
      if (!res.ok) throw new Error('load failed');
      const data = (await res.json()) as { sessions: ApiSession[] };
      setSessions(data.sessions);
    } catch {
      setError(true);
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revokeOthers = useCallback(async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/sessions/revoke-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'others' }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const hasOthers = (sessions ?? []).some((s) => !s.current);

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">{t('security.sessions.title')}</h2>
      <p className="text-muted-foreground text-sm">{t('security.sessions.note')}</p>

      {sessions === null && (
        <p className="text-muted-foreground text-sm">{t('security.sessions.loading')}</p>
      )}
      {error && <p className="text-destructive text-sm">{t('security.sessions.error')}</p>}

      {sessions !== null && sessions.length > 0 && (
        <ul className="divide-y rounded-md border">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-start gap-3 p-3">
              <Monitor
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-sm">
                    {s.userAgent ?? t('security.sessions.unknownDevice')}
                  </span>
                  {s.current && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                      {t('security.sessions.current')}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {t('security.sessions.lastSeen', {
                    when: new Date(s.lastSeenAt).toLocaleString(),
                  })}
                  {s.ip ? ` · ${s.ip}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {sessions !== null && !hasOthers && !error && (
        <p className="text-muted-foreground text-sm">{t('security.sessions.empty')}</p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {hasOthers && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 gap-2"
            disabled={busy}
            onClick={() => void revokeOthers()}
          >
            <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('security.sessions.signOutOthers')}
          </Button>
        )}
        <form action="/api/auth/signout" method="post">
          <Button variant="default" type="submit" className="min-h-11 gap-2">
            <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('security.sessions.signOut')}
          </Button>
        </form>
      </div>
    </section>
  );
}
