'use client';

import { CreatePageCard } from '@/components/automation/builder/create-page-card';
import { NotifyCard } from '@/components/automation/builder/notify-card';
import { SendWebhookCard } from '@/components/automation/builder/send-webhook-card';
import { SetPropertyCard } from '@/components/automation/builder/set-property-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AutomationActionType } from '@/db/schema';
import { useT } from '@/lib/i18n/provider';

const ACTION_TYPES: AutomationActionType[] = [
  'notify',
  'set_property',
  'create_page',
  'send_webhook',
];

type Props = {
  type: AutomationActionType;
  config: Record<string, unknown>;
  onChange: (next: { type: AutomationActionType; config: Record<string, unknown> }) => void;
};

export function ActionCardHost({ type, config, onChange }: Props) {
  const t = useT();
  function setConfig(next: Record<string, unknown>) {
    onChange({ type, config: next });
  }
  return (
    <div className="space-y-3 rounded-md border p-3">
      <Select
        value={type}
        onValueChange={(v) => onChange({ type: v as AutomationActionType, config: {} })}
      >
        <SelectTrigger aria-label={t('automation.builder.action.label')} className="w-full text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACTION_TYPES.map((a) => (
            <SelectItem key={a} value={a}>
              {t(`automation.builder.action.${a}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {type === 'notify' ? <NotifyCard config={config} onChange={setConfig} /> : null}
      {type === 'set_property' ? <SetPropertyCard config={config} onChange={setConfig} /> : null}
      {type === 'create_page' ? <CreatePageCard config={config} onChange={setConfig} /> : null}
      {type === 'send_webhook' ? <SendWebhookCard config={config} onChange={setConfig} /> : null}
    </div>
  );
}
