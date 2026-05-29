'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
// Import the canonical type from the server source of truth instead of
// re-declaring it locally — the local re-declaration drifting out of sync with
// NOTIFICATION_TYPES was the root cause of #72.
import type { NotificationType } from '@/lib/email/prefs';
import { useT } from '@/lib/i18n/provider';

type Pref = {
  notificationType: NotificationType;
  emailEnabled: boolean;
  digestOnly: boolean;
};

type PrefsResponse = {
  prefs: Pref[];
  emailEnabled: boolean;
};

// i18n label key per emailable type. Kept exhaustive over NotificationType so
// adding a type to NOTIFICATION_TYPES forces a label here (compile error).
const TYPE_LABEL_KEYS: Record<NotificationType, string> = {
  mention: 'notifications.type.mention',
  comment_reply: 'notifications.type.commentReply',
};

// The three mutually-exclusive choices, mapped to the (emailEnabled, digestOnly) pair.
type Choice = 'email' | 'in_app' | 'digest';

const CHOICES: { value: Choice; label: string; emailEnabled: boolean; digestOnly: boolean }[] = [
  { value: 'in_app', label: 'In-app only', emailEnabled: false, digestOnly: false },
  { value: 'email', label: 'Email', emailEnabled: true, digestOnly: false },
  { value: 'digest', label: 'Daily digest', emailEnabled: true, digestOnly: true },
];

function choiceOf(pref: Pref): Choice {
  if (!pref.emailEnabled) return 'in_app';
  return pref.digestOnly ? 'digest' : 'email';
}

export function NotificationPrefs() {
  const t = useT();
  const bannerId = useId();
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [smtpEnabled, setSmtpEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/notifications/prefs');
        if (!res.ok) throw new Error('Failed to load notification preferences');
        const data = (await res.json()) as PrefsResponse;
        if (!active) return;
        setPrefs(data.prefs);
        setSmtpEnabled(data.emailEnabled);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function select(type: NotificationType, choice: Choice) {
    const opt = CHOICES.find((c) => c.value === choice);
    if (!opt) return;
    const prev = prefs;
    // Optimistic update.
    setPrefs((cur) =>
      cur
        ? cur.map((p) =>
            p.notificationType === type
              ? { ...p, emailEnabled: opt.emailEnabled, digestOnly: opt.digestOnly }
              : p,
          )
        : cur,
    );
    setError(null);
    try {
      const res = await fetch('/api/notifications/prefs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          notificationType: type,
          emailEnabled: opt.emailEnabled,
          digestOnly: opt.digestOnly,
        }),
      });
      if (!res.ok) throw new Error('Failed to save preference');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      setPrefs(prev); // Roll back.
    }
  }

  if (error && !prefs) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!prefs) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!smtpEnabled && (
          <div
            id={bannerId}
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {t('notifications.smtp.disabledBanner')}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {prefs.map((pref) => {
          const current = choiceOf(pref);
          return (
            <div
              key={pref.notificationType}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-medium">
                {t(TYPE_LABEL_KEYS[pref.notificationType])}
              </span>
              <div className="flex gap-1">
                {CHOICES.map((c) => {
                  // Email-bearing options require a configured SMTP server.
                  const disabled = !smtpEnabled && c.emailEnabled;
                  return (
                    <Button
                      key={c.value}
                      type="button"
                      size="sm"
                      variant={current === c.value ? 'default' : 'outline'}
                      disabled={disabled}
                      // Non-color, screen-reader-available reason for the disabled
                      // state (#74): a title tooltip + aria-describedby pointing at
                      // the SMTP banner, so the "why" isn't conveyed by color alone.
                      title={disabled ? t('notifications.smtp.disabledReason') : undefined}
                      aria-describedby={disabled ? bannerId : undefined}
                      onClick={() => select(pref.notificationType, c.value)}
                    >
                      {c.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
