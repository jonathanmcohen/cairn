// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { openEditorDialog, resetEditorDialogBus } from '@/components/editor/editor-dialog-bus';
import { EditorDialogs } from '@/components/editor/editor-dialogs';

afterEach(() => {
  cleanup();
  resetEditorDialogBus();
});

describe('<EditorDialogs>', () => {
  it('resolves footnote text on submit', async () => {
    render(<EditorDialogs />);
    const promise = openEditorDialog({ kind: 'footnote', title: 'Footnote' });
    const field = (await screen.findByLabelText('Footnote text')) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'see ref' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect(await promise).toEqual({ text: 'see ref' }));
  });

  it('resolves null on cancel', async () => {
    render(<EditorDialogs />);
    const promise = openEditorDialog({ kind: 'footnote', title: 'Footnote' });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await promise).toBeNull();
  });

  it('citation form collects all five fields', async () => {
    render(<EditorDialogs />);
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

  it('flashcard form collects front/back/deck', async () => {
    render(<EditorDialogs />);
    const promise = openEditorDialog({ kind: 'flashcard', title: 'Flashcard' });
    fireEvent.change(await screen.findByLabelText('Front (question)'), {
      target: { value: 'Q?' },
    });
    fireEvent.change(screen.getByLabelText('Back (answer)'), { target: { value: 'A.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect(await promise).toEqual({ front: 'Q?', back: 'A.', deck: '' }));
  });
});
