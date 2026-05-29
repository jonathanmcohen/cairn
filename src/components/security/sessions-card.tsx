'use client';

import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * #70 (minimal honest slice). This Cairn instance uses stateless JWT sessions
 * (Auth.js Credentials provider forces strategy: 'jwt'), so there is no
 * server-side session store to enumerate per-device. We therefore ship a real
 * "sign out of this browser" control (the same POST the sidebar uses) plus an
 * honest explanation, rather than a fake devices list we couldn't revoke.
 * Remote "sign out everywhere" (token_version / JWT denylist) is a tracked
 * follow-up — see the round-2 plan index.
 */
export function SessionsCard() {
  const t = useT();
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">{t('security.sessions.title')}</h2>
      <p className="text-muted-foreground text-sm">{t('security.sessions.note')}</p>
      <form action="/api/auth/signout" method="post">
        <Button variant="default" type="submit" className="min-h-11 gap-2">
          <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
          {t('security.sessions.signOut')}
        </Button>
      </form>
    </section>
  );
}
