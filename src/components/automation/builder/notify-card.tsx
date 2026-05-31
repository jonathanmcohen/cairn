'use client';

import { useId, useState } from 'react';
import { useMembers } from '@/components/automation/builder/use-pickers';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n/provider';

type Props = {
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
};

export function NotifyCard({ config, onChange }: Props) {
  const t = useT();
  const msgId = useId();
  const userSearchId = useId();
  const [query, setQuery] = useState('');
  const { options, loading } = useMembers(query);
  const selectedUserId = typeof config.userId === 'string' ? config.userId : '';
  const message = typeof config.message === 'string' ? config.message : '';

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={userSearchId}>{t('automation.builder.notify.user')}</Label>
        <Input
          id={userSearchId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('automation.builder.notify.user')}
        />
        <ul className="max-h-40 overflow-y-auto rounded-md border">
          {!loading && options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {t('automation.notify.empty')}
            </li>
          ) : (
            options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                    o.value === selectedUserId ? 'bg-muted font-medium' : ''
                  }`}
                  onClick={() => onChange({ ...config, userId: o.value })}
                >
                  {o.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={msgId}>{t('automation.builder.notify.message')}</Label>
        <Input
          id={msgId}
          value={message}
          onChange={(e) => onChange({ ...config, message: e.target.value })}
        />
      </div>
    </div>
  );
}
