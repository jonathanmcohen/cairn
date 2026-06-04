// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openEditorDialog, resetEditorDialogBus } from '@/components/editor/editor-dialog-bus';
import { EditorDialogs } from '@/components/editor/editor-dialogs';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

const lookupResponse = {
  meta: {
    source: 'doi',
    authors: [{ family: 'Smith', given: 'J' }],
    title: 'A Paper',
    year: 2021,
    doi: '10.1234/abc',
  },
  formatted: {
    apa: 'Smith, J. (2021). A Paper.',
    mla: 'Smith, J. "A Paper." 2021.',
    chicago: 'Smith, J. 2021. "A Paper."',
  },
};

beforeEach(() => {
  resetEditorDialogBus();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(url).toContain('/api/citations/lookup?doi=10.1234%2Fabc');
      return { ok: true, json: async () => lookupResponse };
    }) as unknown as typeof fetch,
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

describe('manual citation modal DOI auto-fetch', () => {
  it('fetches by DOI and populates author/title/year', async () => {
    renderHost();
    openEditorDialog({ kind: 'citation', title: 'Citation' });

    const doiField = (await screen.findByLabelText('DOI (optional)')) as HTMLInputElement;
    fireEvent.change(doiField, { target: { value: '10.1234/abc' } });

    fireEvent.click(screen.getByRole('button', { name: enMessages['editor.citation.fetchDoi'] }));

    expect(await screen.findByDisplayValue('Smith, J')).toBeTruthy();
    await waitFor(() => expect(screen.getByDisplayValue('A Paper')).toBeTruthy());
    expect(screen.getByDisplayValue('2021')).toBeTruthy();
  });
});
