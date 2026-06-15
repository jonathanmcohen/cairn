import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { emailEnabled } from '@/lib/email/transport';
import { listDeckTree } from '@/lib/flashcards/decks';
import { getWorkspaceFlashcardSettings } from '@/lib/flashcards/settings';
import { FlashcardsSettingsForm } from './flashcards-settings-form';

/**
 * v0.10.2 F3 Task D — Admin-only Flashcard workspace settings page.
 *
 * Reads current settings (or defaults) plus the deck tree for the default-deck
 * picker. SMTP state is detected server-side so the reminder-hour field can be
 * disabled with an explanatory hint when SMTP is not configured.
 */
export default async function FlashcardsSettingsPage() {
  const ctx = await requireRole('admin');
  const db = getDb();

  const [settings, decks] = await Promise.all([
    getWorkspaceFlashcardSettings(db, ctx.workspaceId),
    listDeckTree(db, ctx.workspaceId),
  ]);

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
        page="Flashcard settings"
      />
      <h1 className="mb-2 text-xl font-semibold">Flashcard settings</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Workspace defaults for the spaced-repetition scheduler and optional daily-reminder email.
        Members cannot override these workspace-level values individually.
      </p>
      <FlashcardsSettingsForm
        initialSettings={{
          defaultDeckId: settings.defaultDeckId ?? null,
          newPerDay: settings.newPerDay,
          reviewLimit: settings.reviewLimit,
          easeStart: settings.easeStart,
          leechThreshold: settings.leechThreshold,
          reminderHour: settings.reminderHour ?? null,
        }}
        decks={decks}
        smtpConfigured={await emailEnabled(db)}
      />
    </section>
  );
}
