// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type EditorDialogCitationResult,
  openEditorDialog,
  resetEditorDialogBus,
} from '@/components/editor/editor-dialog-bus';
import { EditorDialogs } from '@/components/editor/editor-dialogs';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

const lookupResponse = {
  meta: {
    source: 'doi',
    authors: [{ family: 'Doe', given: 'Jane' }],
    title: 'A Study',
    year: 2020,
    doi: '10.1234/abc',
  },
  formatted: {
    apa: 'Doe, J. (2020). A Study. https://doi.org/10.1234/abc',
    mla: 'Doe, Jane. "A Study." 2020.',
    chicago: 'Doe, Jane. 2020. "A Study."',
  },
};

beforeEach(() => {
  resetEditorDialogBus();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => lookupResponse,
    })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetEditorDialogBus();
});

function renderHost() {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      <EditorDialogs />
    </I18nProvider>,
  );
}

describe('citationLookup dialog kind', () => {
  it('opens CitationAddDialog and resolves the looked-up meta on Insert', async () => {
    renderHost();

    const pending = openEditorDialog({
      kind: 'citationLookup',
      title: 'Citation (DOI/PubMed lookup)',
      defaultStyle: 'apa',
    });

    const input = (await screen.findByLabelText(/DOI or PubMed ID/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10.1234/abc' } });

    await waitFor(() =>
      expect(screen.getByTestId('citation-preview').textContent).toContain('A Study'),
    );

    fireEvent.click(screen.getByRole('button', { name: /Insert/i }));

    const result = await pending;
    expect(result).not.toBeNull();
    if (!result || !('kind' in result) || result.kind !== 'citationLookup') {
      throw new Error('expected a citationLookup result');
    }
    const lookup = result as EditorDialogCitationResult;
    expect(lookup.kind).toBe('citationLookup');
    expect(lookup.meta.doi).toBe('10.1234/abc');
    expect(lookup.style).toBe('apa');
    expect(lookup.formatted.apa).toContain('A Study');
  });

  it('resolves null on cancel', async () => {
    renderHost();
    const pending = openEditorDialog({
      kind: 'citationLookup',
      title: 'Citation (DOI/PubMed lookup)',
    });
    fireEvent.click(await screen.findByRole('button', { name: /Cancel/i }));
    expect(await pending).toBeNull();
  });
});
