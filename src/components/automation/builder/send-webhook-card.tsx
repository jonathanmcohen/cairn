'use client';

import { useWebhooks } from '@/components/automation/builder/use-pickers';
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

export function SendWebhookCard({ config, onChange }: Props) {
  const t = useT();
  const webhookId = typeof config.webhookId === 'string' ? config.webhookId : '';
  const { options: webhooks } = useWebhooks();

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>{t('automation.builder.sendWebhook.webhook')}</Label>
        <Select value={webhookId} onValueChange={(v) => onChange({ ...config, webhookId: v })}>
          <SelectTrigger className="w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {webhooks.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
