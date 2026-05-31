'use client';

import { useId } from 'react';
import { useDatabases, useProperties } from '@/components/automation/builder/use-pickers';
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

export function SetPropertyCard({ config, onChange }: Props) {
  const t = useT();
  const valueId = useId();
  const databaseId = typeof config.databaseId === 'string' ? config.databaseId : '';
  const propertyId = typeof config.propertyId === 'string' ? config.propertyId : '';
  const value = config.value == null ? '' : String(config.value);
  const { options: dbs } = useDatabases();
  const { options: props } = useProperties(databaseId || null);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>{t('automation.builder.setProperty.database')}</Label>
        <Select
          value={databaseId}
          onValueChange={(v) => onChange({ ...config, databaseId: v, propertyId: '' })}
        >
          <SelectTrigger className="w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dbs.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>{t('automation.builder.setProperty.property')}</Label>
        <Select value={propertyId} onValueChange={(v) => onChange({ ...config, propertyId: v })}>
          <SelectTrigger className="w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {props.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={valueId}>{t('automation.builder.setProperty.value')}</Label>
        <Input
          id={valueId}
          value={value}
          onChange={(e) => onChange({ ...config, value: e.target.value })}
        />
      </div>
    </div>
  );
}
