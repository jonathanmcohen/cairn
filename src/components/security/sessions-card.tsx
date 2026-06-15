'use client';

import { LogOut, Monitor } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { signOutAction } from '@/lib/auth/sign-out-action';
import { useT } from '@/lib/i18n/provider';
import { friendlyUserAgent } from '@/lib/security/user-agent-label';

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
export function SessionsCard({ userEmail }: { userEmail?: string }) {
  const t = useT();
  const [sessions, setSessions] = useState<ApiSession[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // v0.10.3 Q-2 — id of the row whose per-session Revoke is in flight, so only
  // that row's button shows the disabled state.
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // v0.10.2 S11 — themed sign-out confirmation (mirrors the sidebar footer's
  // intercept). Keep the working Server Action <form action={signOutAction}>;
  // gate its submit behind the confirm. confirmedRef carries the "yes" past the
  // synthetic requestSubmit() so the second submit runs the real action.
  const confirm = useConfirm();
  const signOutFormRef = useRef<HTMLFormElement>(null);
  const signOutConfirmedRef = useRef(false);
  const handleSignOutSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (signOutConfirmedRef.current) {
      signOutConfirmedRef.current = false;
      return; // allow the real submit through to signOutAction
    }
    e.preventDefault();
    void (async () => {
      const ok = await confirm({
        title: t('sidebar.signOutConfirm.title'),
        description: userEmail ? t('sidebar.signOutConfirm.body', { email: userEmail }) : undefined,
        confirmLabel: t('sidebar.signOutConfirm.confirm'),
        cancelLabel: t('common.cancel'),
        variant: 'danger',
      });
      if (ok) {
        signOutConfirmedRef.current = true;
        signOutFormRef.current?.requestSubmit();
      }
    })();
  };

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

  // v0.10.3 Q-2 — revoke a single device. 404 (already gone / not ours) is
  // treated as success: the row is gone either way, so just reload.
  const revokeOne = useCallback(
    async (id: string) => {
      setRevokingId(id);
      try {
        await fetch(`/api/auth/sessions/${id}/revoke`, { method: 'POST' });
        await load();
      } finally {
        setRevokingId(null);
      }
    },
    [load],
  );

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
                    {friendlyUserAgent(s.userAgent) ?? t('security.sessions.unknownDevice')}
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
              {/* v0.10.3 Q-2 — per-session revoke (the current device uses the
                  Sign-out button instead, so it carries no Revoke). */}
              {!s.current && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={revokingId === s.id}
                  data-testid={`revoke-session-${s.id}`}
                  aria-label={t('security.sessions.revokeOne', {
                    device: friendlyUserAgent(s.userAgent) ?? t('security.sessions.unknownDevice'),
                  })}
                  onClick={() => void revokeOne(s.id)}
                >
                  {t('security.sessions.revoke')}
                </Button>
              )}
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
        {/* A1 (#80) — Server Action sign-out (was a CSRF-less POST that Auth.js
            v5 rejected). Same defect as the sidebar footer. */}
        <form ref={signOutFormRef} action={signOutAction} onSubmit={handleSignOutSubmit}>
          <Button variant="default" type="submit" className="min-h-11 gap-2">
            <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('security.sessions.signOut')}
          </Button>
        </form>
      </div>
    </section>
  );
}
