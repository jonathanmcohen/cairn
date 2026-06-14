import { describe, expect, it } from 'vitest';
import arMessages from '../../messages/ar.json' with { type: 'json' };
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

// v0.10.2 F2 Task C — flashcard decks UI (route + decks-client + study deck
// filter + manage tree picker). Every user-facing string flows through the
// useT() provider; these keys must exist (non-empty) in all three locales.
const NEW_KEYS = [
  'flashcards.study.deckQueueEmpty',
  'flashcards.decks.nav',
  'flashcards.decks.title',
  'flashcards.decks.intro',
  'flashcards.decks.back',
  'flashcards.decks.empty',
  'flashcards.decks.newDeck',
  'flashcards.decks.newDeck.nameLabel',
  'flashcards.decks.rename',
  'flashcards.decks.renameLabel',
  'flashcards.decks.dragHandle',
  'flashcards.decks.rootDropLabel',
  'flashcards.decks.defaultBadge',
  'flashcards.decks.pill.new',
  'flashcards.decks.pill.learning',
  'flashcards.decks.pill.review',
  'flashcards.decks.pill.mature',
  'flashcards.decks.pill.newAria',
  'flashcards.decks.pill.learningAria',
  'flashcards.decks.pill.reviewAria',
  'flashcards.decks.pill.matureAria',
  'flashcards.decks.icon',
  'flashcards.decks.color',
  'flashcards.decks.color.none',
  'flashcards.decks.color.red',
  'flashcards.decks.color.orange',
  'flashcards.decks.color.yellow',
  'flashcards.decks.color.green',
  'flashcards.decks.color.blue',
  'flashcards.decks.color.purple',
  'flashcards.decks.options',
  'flashcards.decks.options.title',
  'flashcards.decks.options.description',
  'flashcards.decks.options.newPerDay',
  'flashcards.decks.options.reviewLimit',
  'flashcards.decks.options.startingEase',
  'flashcards.decks.options.inheritPlaceholder',
  'flashcards.decks.options.save',
  'flashcards.decks.options.cancel',
  'flashcards.decks.study',
  'flashcards.decks.menu',
  'flashcards.decks.menu.moveAll',
  'flashcards.decks.menu.merge',
  'flashcards.decks.menu.delete',
  'flashcards.decks.moveAll.title',
  'flashcards.decks.moveAll.description',
  'flashcards.decks.moveAll.confirm',
  'flashcards.decks.merge.title',
  'flashcards.decks.merge.description',
  'flashcards.decks.merge.confirm',
  'flashcards.decks.picker.label',
  'flashcards.decks.picker.placeholder',
  'flashcards.decks.delete.title',
  'flashcards.decks.delete.description',
  'flashcards.decks.delete.disposition',
  'flashcards.decks.delete.moveToDefault',
  'flashcards.decks.delete.deleteCards.one',
  'flashcards.decks.delete.deleteCards.other',
  'flashcards.decks.delete.deleteCardsZero',
  'flashcards.decks.delete.confirmLabel',
  'flashcards.decks.delete.phrase',
  'flashcards.decks.delete.confirm',
  'flashcards.decks.cancel',
  'flashcards.decks.save',
  'flashcards.decks.toast.created',
  'flashcards.decks.toast.exists',
  'flashcards.decks.toast.renamed',
  'flashcards.decks.toast.renameFailed',
  'flashcards.decks.toast.iconUpdated',
  'flashcards.decks.toast.colorUpdated',
  'flashcards.decks.toast.optionsSaved',
  'flashcards.decks.toast.optionsFailed',
  'flashcards.decks.toast.reparented',
  'flashcards.decks.toast.reparentCycle',
  'flashcards.decks.toast.reparentFailed',
  'flashcards.decks.toast.merged',
  'flashcards.decks.toast.mergeFailed',
  'flashcards.decks.toast.movedAll',
  'flashcards.decks.toast.moveAllFailed',
  'flashcards.decks.toast.deleted',
  'flashcards.decks.toast.deleteFailed',
] as const;

// Placeholder-carrying keys: the interpolation token must survive translation.
const PLACEHOLDER_KEYS: Array<[string, string]> = [
  ['flashcards.decks.pill.newAria', '{count}'],
  ['flashcards.decks.pill.learningAria', '{count}'],
  ['flashcards.decks.pill.reviewAria', '{count}'],
  ['flashcards.decks.pill.matureAria', '{count}'],
  ['flashcards.decks.delete.description', '{phrase}'],
  ['flashcards.decks.delete.confirmLabel', '{phrase}'],
  ['flashcards.decks.delete.deleteCards.one', '{count}'],
  ['flashcards.decks.delete.deleteCards.other', '{count}'],
];

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('item F2 Task C — flashcard decks i18n keys', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of NEW_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').trim().length).toBeGreaterThan(0);
      });
    }
  }

  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const [key, token] of PLACEHOLDER_KEYS) {
      it(`${locale} ${key} keeps the ${token} placeholder`, () => {
        expect(messages[key]).toContain(token);
      });
    }
  }
});
