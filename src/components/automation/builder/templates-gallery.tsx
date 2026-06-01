'use client';

import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BuilderModel } from '@/lib/automation/builder';
import { BUILDER_TEMPLATES } from '@/lib/automation/templates';
import { useT } from '@/lib/i18n/provider';

type Props = {
  onPick: (model: BuilderModel) => void;
};

export function TemplatesGallery({ onPick }: Props) {
  const t = useT();
  const searchId = useId();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BUILDER_TEMPLATES;
    return BUILDER_TEMPLATES.filter((tpl) => {
      const hay = `${t(tpl.nameKey)} ${t(tpl.descKey)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, t]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t('automation.builder.templates.title')}</h3>
      <Input
        id={searchId}
        aria-label={t('automation.builder.templates.search')}
        placeholder={t('automation.builder.templates.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('automation.builder.templates.empty')}</p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((tpl) => (
            <Button
              key={tpl.id}
              type="button"
              variant="outline"
              className="h-auto w-full flex-col items-start justify-start whitespace-normal py-2 text-left text-sm"
              onClick={() => onPick(tpl.build())}
            >
              <span className="font-medium">{t(tpl.nameKey)}</span>
              <span className="text-xs text-muted-foreground">{t(tpl.descKey)}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
