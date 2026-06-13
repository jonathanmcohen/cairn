'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { DeckTreePicker } from '@/components/flashcards/deck-tree-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DeckRow } from '@/lib/flashcards/decks';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.10.2 F3 Task D — Flashcard workspace settings form.
 *
 * Fields:
 *   - Default deck (DeckTreePicker, "No default" option)
 *   - New cards / day
 *   - Review limit / day
 *   - Starting ease
 *   - Leech threshold
 *   - Daily reminder time (hour select 0..23, disabled when SMTP is not configured)
 */

type InitialSettings = {
  defaultDeckId: string | null;
  newPerDay: number;
  reviewLimit: number;
  easeStart: number;
  leechThreshold: number;
  reminderHour: number | null;
};

/** Sentinel value used in the reminder select to represent "null" (disabled). */
const NO_REMINDER = '__none__';
/** Sentinel value used in the deck picker to represent "no default deck". */
const NO_DECK = '__none__';

export function FlashcardsSettingsForm({
  initialSettings,
  decks,
  smtpConfigured,
}: {
  initialSettings: InitialSettings;
  decks: DeckRow[];
  smtpConfigured: boolean;
}) {
  const t = useT();
  const router = useRouter();

  // Field IDs for label association.
  const defaultDeckId = useId();
  const newPerDayId = useId();
  const reviewLimitId = useId();
  const easeStartId = useId();
  const leechThresholdId = useId();
  const reminderHourId = useId();

  const [defaultDeck, setDefaultDeck] = useState<string>(initialSettings.defaultDeckId ?? NO_DECK);
  const [newPerDay, setNewPerDay] = useState(initialSettings.newPerDay);
  const [reviewLimit, setReviewLimit] = useState(initialSettings.reviewLimit);
  const [easeStart, setEaseStart] = useState(initialSettings.easeStart);
  const [leechThreshold, setLeechThreshold] = useState(initialSettings.leechThreshold);
  const [reminderHour, setReminderHour] = useState<string>(
    initialSettings.reminderHour !== null ? String(initialSettings.reminderHour) : NO_REMINDER,
  );

  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        defaultDeckId: defaultDeck === NO_DECK ? null : defaultDeck,
        newPerDay,
        reviewLimit,
        easeStart,
        leechThreshold,
        reminderHour: reminderHour === NO_REMINDER ? null : Number(reminderHour),
      };
      const res = await fetch('/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`${t('flashcards.settings.saveError')} ${payload.error ?? res.status}`);
        return;
      }
      toast.success(t('flashcards.settings.saved'));
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  // Build hours 0..23 for the reminder select.
  const hourOptions = Array.from({ length: 24 }, (_, h) => h);

  return (
    <form
      onSubmit={onSubmit}
      data-testid="flashcards-settings-form"
      className="flex flex-col gap-6 rounded-md border p-4"
    >
      {/* Default deck */}
      <div>
        <Label htmlFor={defaultDeckId} className="mb-1 block text-sm font-medium">
          {t('flashcards.settings.defaultDeck.label')}
        </Label>
        <p className="mb-2 text-xs text-muted-foreground">
          {t('flashcards.settings.defaultDeck.hint')}
        </p>
        <DeckTreePicker
          decks={decks}
          value={defaultDeck}
          onValueChange={setDefaultDeck}
          placeholder={t('flashcards.settings.defaultDeck.none')}
          extraOptions={[{ value: NO_DECK, label: t('flashcards.settings.defaultDeck.none') }]}
          triggerClassName="max-w-xs min-h-11"
          triggerTestId="setting-default-deck"
        />
      </div>

      {/* New cards per day */}
      <div>
        <Label htmlFor={newPerDayId} className="mb-1 block text-sm font-medium">
          {t('flashcards.settings.newPerDay.label')}
        </Label>
        <p className="mb-2 text-xs text-muted-foreground">
          {t('flashcards.settings.newPerDay.hint')}
        </p>
        <Input
          id={newPerDayId}
          type="number"
          min={0}
          value={newPerDay}
          onChange={(e) => setNewPerDay(Number(e.target.value))}
          className="max-w-xs"
          data-testid="setting-new-per-day"
        />
      </div>

      {/* Review limit per day */}
      <div>
        <Label htmlFor={reviewLimitId} className="mb-1 block text-sm font-medium">
          {t('flashcards.settings.reviewLimit.label')}
        </Label>
        <p className="mb-2 text-xs text-muted-foreground">
          {t('flashcards.settings.reviewLimit.hint')}
        </p>
        <Input
          id={reviewLimitId}
          type="number"
          min={0}
          value={reviewLimit}
          onChange={(e) => setReviewLimit(Number(e.target.value))}
          className="max-w-xs"
          data-testid="setting-review-limit"
        />
      </div>

      {/* Starting ease */}
      <div>
        <Label htmlFor={easeStartId} className="mb-1 block text-sm font-medium">
          {t('flashcards.settings.easeStart.label')}
        </Label>
        <p className="mb-2 text-xs text-muted-foreground">
          {t('flashcards.settings.easeStart.hint')}
        </p>
        <Input
          id={easeStartId}
          type="number"
          min={1.3}
          step={0.1}
          value={easeStart}
          onChange={(e) => setEaseStart(Number(e.target.value))}
          className="max-w-xs"
          data-testid="setting-ease-start"
        />
      </div>

      {/* Leech threshold */}
      <div>
        <Label htmlFor={leechThresholdId} className="mb-1 block text-sm font-medium">
          {t('flashcards.settings.leechThreshold.label')}
        </Label>
        <p className="mb-2 text-xs text-muted-foreground">
          {t('flashcards.settings.leechThreshold.hint')}
        </p>
        <Input
          id={leechThresholdId}
          type="number"
          min={1}
          value={leechThreshold}
          onChange={(e) => setLeechThreshold(Number(e.target.value))}
          className="max-w-xs"
          data-testid="setting-leech-threshold"
        />
      </div>

      {/* Daily reminder hour */}
      <div>
        <Label htmlFor={reminderHourId} className="mb-1 block text-sm font-medium">
          {t('flashcards.settings.reminderHour.label')}
        </Label>
        {smtpConfigured ? (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {t('flashcards.settings.reminderHour.hint')}
            </p>
            <Select value={reminderHour} onValueChange={setReminderHour} disabled={!smtpConfigured}>
              <SelectTrigger
                id={reminderHourId}
                className="max-w-xs min-h-11"
                data-testid="setting-reminder-hour"
              >
                <SelectValue placeholder={t('flashcards.settings.reminderHour.none')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REMINDER}>
                  {t('flashcards.settings.reminderHour.none')}
                </SelectItem>
                {hourOptions.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, '0')}:00 UTC
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {t('flashcards.settings.reminderHour.hint')}
            </p>
            <Select value={reminderHour} onValueChange={setReminderHour} disabled={true}>
              <SelectTrigger
                id={reminderHourId}
                className="max-w-xs min-h-11 cursor-not-allowed opacity-50"
                data-testid="setting-reminder-hour"
                disabled={true}
              >
                <SelectValue placeholder={t('flashcards.settings.reminderHour.none')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REMINDER}>
                  {t('flashcards.settings.reminderHour.none')}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {t('flashcards.settings.reminderHour.smtpOff')}
            </p>
          </>
        )}
      </div>

      <div>
        <Button type="submit" disabled={saving} className="min-h-11">
          {saving ? '…' : t('flashcards.settings.save')}
        </Button>
      </div>
    </form>
  );
}
