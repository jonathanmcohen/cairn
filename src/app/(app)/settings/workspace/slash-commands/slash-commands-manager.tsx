'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';
import { useT } from '@/lib/i18n/provider';

export type SlashCommandRowProps = {
  id: string;
  trigger: string;
  label: string;
  templateName: string;
};

export type TemplateOptionProps = { id: string; name: string };

/** Map a SlashCommandError code from the API onto an i18n message key. */
const ERROR_KEY: Record<string, string> = {
  BUILTIN_TRIGGER: 'workspaceSettings.slashCommands.errorBuiltin',
  DUPLICATE_TRIGGER: 'workspaceSettings.slashCommands.errorDuplicate',
  INVALID_TRIGGER: 'workspaceSettings.slashCommands.errorInvalidTrigger',
  TEMPLATE_NOT_FOUND: 'workspaceSettings.slashCommands.errorTemplateNotFound',
  TEMPLATE_NOT_INSERTABLE: 'workspaceSettings.slashCommands.errorTemplateNotInsertable',
};

/**
 * v0.10.0 F2 — list + create form for the workspace's custom slash commands.
 * Rows render from server props; mutations POST/DELETE the slash-commands API
 * and `router.refresh()` so the server page re-lists (no client copy to
 * drift). Built-in-collision / duplicate errors surface inline from the
 * API's typed `code`. The template picker is a Radix Select (house rule: no
 * native select; aria-label on the trigger, no label wrap).
 */
export function SlashCommandsManager({
  workspaceId,
  commands,
  templates,
}: {
  workspaceId: string;
  commands: SlashCommandRowProps[];
  templates: TemplateOptionProps[];
}) {
  const t = useT();
  const router = useRouter();
  const triggerId = useId();
  const labelId = useId();

  const [trigger, setTrigger] = useState('');
  const [label, setLabel] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/slash-commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trigger, label, templateId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        const key = body?.code ? ERROR_KEY[body.code] : undefined;
        setError(t(key ?? 'workspaceSettings.slashCommands.errorGeneric'));
        return;
      }
      setTrigger('');
      setLabel('');
      setTemplateId('');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(commandId: string) {
    setError(null);
    setDeletingId(commandId);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/slash-commands/${commandId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError(t('workspaceSettings.slashCommands.errorGeneric'));
        return;
      }
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  const canSubmit = trigger.trim().length > 0 && label.trim().length > 0 && templateId !== '';

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">{t('workspaceSettings.slashCommands.title')}</h1>
      <p className="mb-1 text-sm text-muted-foreground">
        {t('workspaceSettings.slashCommands.description')}
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        {t('workspaceSettings.slashCommands.staleHint')}
      </p>

      {error ? (
        <div className="mb-4">
          <StatusBanner variant="error">{error}</StatusBanner>
        </div>
      ) : null}

      {commands.length === 0 ? (
        <p className="mb-6 text-sm text-muted-foreground" data-testid="slash-commands-empty">
          {t('workspaceSettings.slashCommands.empty')}
        </p>
      ) : (
        <ul className="mb-6 divide-y rounded-lg border" data-testid="slash-commands-list">
          {commands.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm">/{c.trigger}</code>
              <span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>
              <span className="truncate text-xs text-muted-foreground">{c.templateName}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deletingId === c.id}
                aria-label={`${t('workspaceSettings.slashCommands.delete')} /${c.trigger}`}
                onClick={() => remove(c.id)}
              >
                {t('workspaceSettings.slashCommands.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex max-w-lg flex-col gap-4 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !submitting) void create();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={triggerId} className="text-sm font-medium">
            {t('workspaceSettings.slashCommands.triggerLabel')}
          </label>
          <Input
            id={triggerId}
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder={t('workspaceSettings.slashCommands.triggerPlaceholder')}
            data-testid="slash-command-trigger-input"
          />
          <p className="text-xs text-muted-foreground">
            {t('workspaceSettings.slashCommands.triggerHint')}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={labelId} className="text-sm font-medium">
            {t('workspaceSettings.slashCommands.labelLabel')}
          </label>
          <Input
            id={labelId}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('workspaceSettings.slashCommands.labelPlaceholder')}
            data-testid="slash-command-label-input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            {t('workspaceSettings.slashCommands.templateLabel')}
          </span>
          {templates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('workspaceSettings.slashCommands.noTemplates')}
            </p>
          ) : (
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger
                aria-label={t('workspaceSettings.slashCommands.templateLabel')}
                data-testid="slash-command-template-select"
              >
                <SelectValue
                  placeholder={t('workspaceSettings.slashCommands.templatePlaceholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div>
          <Button type="submit" disabled={!canSubmit || submitting}>
            {submitting
              ? t('workspaceSettings.slashCommands.creating')
              : t('workspaceSettings.slashCommands.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
