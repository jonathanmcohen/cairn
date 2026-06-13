// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { openEditorDialog, resetEditorDialogBus } from '@/components/editor/editor-dialog-bus';
import { EditorDialogs } from '@/components/editor/editor-dialogs';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

afterEach(() => {
  cleanup();
  resetEditorDialogBus();
});

// EditorDialogs calls useT(), so it must mount inside an I18nProvider.
function renderDialogs() {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      <EditorDialogs />
    </I18nProvider>,
  );
}

describe('<EditorDialogs>', () => {
  it('resolves footnote text on submit', async () => {
    renderDialogs();
    const promise = openEditorDialog({ kind: 'footnote', title: 'Footnote' });
    const field = (await screen.findByLabelText('Footnote text')) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'see ref' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect(await promise).toEqual({ text: 'see ref' }));
  });

  it('resolves null on cancel', async () => {
    renderDialogs();
    const promise = openEditorDialog({ kind: 'footnote', title: 'Footnote' });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await promise).toBeNull();
  });

  it('citation form collects all five fields', async () => {
    renderDialogs();
    const promise = openEditorDialog({ kind: 'citation', title: 'Citation' });
    fireEvent.change(await screen.findByLabelText('Author (Last, F.)'), {
      target: { value: 'Doe, J.' },
    });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A Study' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2020' } });
    fireEvent.change(screen.getByLabelText('DOI (optional)'), { target: { value: '10.1/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(async () =>
      expect(await promise).toEqual({
        author: 'Doe, J.',
        title: 'A Study',
        year: '2020',
        doi: '10.1/x',
        pubmed: '',
      }),
    );
  });

  it('flashcard form collects front/back + a deck picker (F2-D)', async () => {
    renderDialogs();
    const promise = openEditorDialog({ kind: 'flashcard', title: 'Flashcard' });
    fireEvent.change(await screen.findByLabelText('Front (question)'), {
      target: { value: 'Q?' },
    });
    fireEvent.change(screen.getByLabelText('Back (answer)'), { target: { value: 'A.' } });
    // The deck picker is rendered (decks fetch is best-effort; in jsdom it
    // fails closed so the picker is empty and the card still inserts — reconcile
    // falls back to the workspace Default deck).
    expect(screen.getByTestId('flashcard-deck-picker')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    // No free-text deck field anymore; deckId is absent when the fetch failed.
    await waitFor(async () => expect(await promise).toEqual({ front: 'Q?', back: 'A.' }));
  });
});
