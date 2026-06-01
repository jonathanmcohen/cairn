'use client';

import { useId } from 'react';
import { usePages, useTemplates } from '@/components/automation/builder/use-pickers';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';

type Props = {
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
};

export function CreatePageCard({ config, onChange }: Props) {
  const t = useT();
  const titleId = useId();
  const templateSelectId = useId();
  const parentSelectId = useId();
  const templateId = typeof config.templateId === 'string' ? config.templateId : '';
  const parentId = typeof config.parentId === 'string' ? config.parentId : '';
  const titleTemplate = typeof config.titleTemplate === 'string' ? config.titleTemplate : '';
  const { options: templates } = useTemplates();
  const { options: pages } = usePages();

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={templateSelectId}>{t('automation.builder.createPage.template')}</Label>
        <Select value={templateId} onValueChange={(v) => onChange({ ...config, templateId: v })}>
          <SelectTrigger id={templateSelectId} className="w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {templates.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={parentSelectId}>{t('automation.builder.createPage.parent')}</Label>
        <Select value={parentId} onValueChange={(v) => onChange({ ...config, parentId: v })}>
          <SelectTrigger id={parentSelectId} className="w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pages.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={titleId}>{t('automation.builder.createPage.template')}</Label>
        <Input
          id={titleId}
          value={titleTemplate}
          onChange={(e) => onChange({ ...config, titleTemplate: e.target.value })}
        />
      </div>
    </div>
  );
}
