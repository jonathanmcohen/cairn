'use client';

import { Button } from '@/components/ui/button';
import type { BuilderModel } from '@/lib/automation/builder';
import { BUILDER_TEMPLATES } from '@/lib/automation/templates';
import { useT } from '@/lib/i18n/provider';

type Props = {
  onPick: (model: BuilderModel) => void;
};

export function TemplatesGallery({ onPick }: Props) {
  const t = useT();
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t('automation.builder.templates.title')}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {BUILDER_TEMPLATES.map((tpl) => (
          <Button
            key={tpl.id}
            type="button"
            variant="outline"
            className="h-auto justify-start whitespace-normal py-2 text-left text-sm"
            onClick={() => onPick(tpl.build())}
          >
            {t(tpl.nameKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}
