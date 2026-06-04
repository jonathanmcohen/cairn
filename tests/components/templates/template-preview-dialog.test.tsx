// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemplatePreviewDialog } from '@/components/templates/template-preview-dialog';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../../messages/en.json';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wrap(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={en}>
      {ui}
    </I18nProvider>,
  );
}

describe('TemplatePreviewDialog', () => {
  it('fetches the preview and renders title + blocks', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 't1',
          name: 'Meeting notes',
          kind: 'page',
          blocks: [
            { kind: 'heading', level: 2, text: 'Agenda' },
            { kind: 'database', text: 'Tasks' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    wrap(
      <TemplatePreviewDialog templateId="t1" name="Meeting notes" open onOpenChange={() => {}} />,
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/templates/t1'));
    expect(screen.getByText('Meeting notes')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Agenda')).toBeTruthy());
    expect(screen.getByText('Tasks')).toBeTruthy();
  });

  it('shows an error message when the fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    wrap(<TemplatePreviewDialog templateId="t2" name="Broken" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('Could not load this preview.')).toBeTruthy());
  });
});
