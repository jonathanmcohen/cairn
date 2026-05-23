'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type NotificationType = 'mention' | 'comment_reply';

type Pref = {
  notificationType: NotificationType;
  emailEnabled: boolean;
  digestOnly: boolean;
};

type PrefsResponse = {
  prefs: Pref[];
  emailEnabled: boolean;
};

const TYPE_LABELS: Record<NotificationType, string> = {
  mention: 'Mentions',
  comment_reply: 'Comment replies',
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
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            Email notifications are disabled — no SMTP server is configured. In-app notifications
            still work.
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
              <span className="text-sm font-medium">{TYPE_LABELS[pref.notificationType]}</span>
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
