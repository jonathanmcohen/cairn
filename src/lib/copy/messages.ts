/**
 * Flat, namespaced registry for user-facing strings touched in v0.8.0.
 *
 * Why not the existing src/lib/i18n catalog? i18n is full-translation
 * infrastructure with locales and pluralization; this registry is an English-
 * only stub keyed by stable identifiers, intended as i18n-prep. A future plan
 * can lift these keys into the i18n catalog without renaming any call site —
 * just swap `copy(key)` for `t(key)` at the call site.
 *
 * `copy(key)` THROWS on a missing key so refactors stay honest: dropping a
 * key without updating the call site fails fast in tests.
 *
 * Conventions:
 * - Namespaces: `empty.<feature>.<field>`, `wizard.<step>.<field>`,
 *   `quickCapture.<field>`, `inboxTriage.<field>`, `palette.<field>`.
 * - Headlines are short noun phrases ("No pages yet"); guidance is one
 *   actionable sentence; CTAs are verb-noun ("Create a page", "Save changes").
 */

export const MESSAGES = {
  // Empty states — one (headline, guidance, optional ctaLabel) per feature.
  'empty.pageTree.headline': 'No pages yet',
  'empty.pageTree.guidance':
    'Create your first page to start organizing notes. Pages can nest, link, and embed databases.',
  'empty.pageTree.cta': 'Create a page',

  'empty.search.headline': 'No matches found',
  'empty.search.guidance':
    'Try different keywords, or check that the page you are looking for has not been moved to trash.',

  'empty.dbTable.headline': 'This database is empty',
  'empty.dbTable.guidance': 'Add a row to start tracking entries. Properties become columns.',
  'empty.dbTable.cta': 'Add a row',

  'empty.notifications.headline': 'You are all caught up',
  'empty.notifications.guidance':
    'New mentions, comment replies, and workspace activity will show up here as they happen.',

  'empty.favorites.headline': 'No favorites yet',
  'empty.favorites.guidance':
    'Star a page to keep it within reach. Favorites stay at the top of the sidebar.',

  'empty.inbox.headline': 'Your inbox is empty',
  'empty.inbox.guidance':
    'Press Cmd+Shift+N to capture a quick thought, or share to Cairn from your OS share sheet.',

  'empty.backlinks.headline': 'No backlinks yet',
  'empty.backlinks.guidance':
    'When another page mentions this one with [[Page name]], it will appear here automatically.',

  'empty.recents.headline': 'No recent pages',
  'empty.recents.guidance':
    'Pages you open will show here, sorted by most-recent. Open a page from the sidebar to start.',

  'empty.trash.headline': 'Trash is empty',
  'empty.trash.guidance':
    'Deleted pages land here for 30 days, then are permanently removed. Nothing has been deleted recently.',

  'empty.flashcardsDue.headline': 'No cards due',
  'empty.flashcardsDue.guidance':
    'You are caught up on reviews. Add a flashcard to any page with the /flashcard slash command.',
  'empty.flashcardsDue.cta': 'Browse pages',

  'empty.favorites.cta': 'Browse pages',

  // Onboarding wizard (P10) — polished step copy + CTAs.
  'wizard.welcome.headline': 'Welcome to Cairn',
  'wizard.welcome.guidance':
    'Cairn is your self-hosted, block-based notes app. This quick setup names your workspace and seeds a starter page.',
  'wizard.welcome.cta': 'Get started',
  'wizard.welcome.skip': 'Skip for now',
  'wizard.name.headline': 'Name your workspace',
  'wizard.name.guidance': 'This shows up in the sidebar. You can change it later in Settings.',
  'wizard.name.cta': 'Continue',
  'wizard.name.back': 'Back',
  'wizard.pick.headline': 'Pick a starter',
  'wizard.pick.guidance':
    'Choose a built-in template to seed your workspace, or start with a blank slate.',
  'wizard.pick.ctaPrimary': 'Set up workspace',
  'wizard.pick.ctaSecondary': 'Start blank',
  'wizard.pick.submitting': 'Setting up…',

  // Quick capture modal (P9) — replace generic Save / Cancel with verb-noun.
  'quickCapture.title': 'Quick capture',
  'quickCapture.cta': 'Save to inbox',
  'quickCapture.cancel': 'Cancel',
  'quickCapture.submitting': 'Saving…',

  // Inbox triage (P8) — replace "Done" with explicit "Mark done".
  'inboxTriage.markDone': 'Mark done',
  'inboxTriage.markingDone': 'Working…',

  // Palette (P11).
  'palette.recentHeading': 'Recent',

  // Generic button labels we audit-replace across the v0.8 surfaces.
  'button.saveChanges': 'Save changes',
  'button.createPage': 'Create page',
  'button.cancel': 'Cancel',
  'button.delete': 'Delete',
} as const;

export type CopyKey = keyof typeof MESSAGES;

export function copy(key: CopyKey): string {
  const value = MESSAGES[key];
  if (typeof value !== 'string') {
    throw new Error(`copy key not found: ${String(key)}`);
  }
  return value;
}

export function hasCopy(key: string): key is CopyKey {
  return Object.hasOwn(MESSAGES, key);
}

export function listCopyKeys(): string[] {
  return Object.keys(MESSAGES);
}
