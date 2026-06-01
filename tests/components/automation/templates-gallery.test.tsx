// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TemplatesGallery } from '@/components/automation/builder/templates-gallery';
import { BUILDER_TEMPLATES } from '@/lib/automation/templates';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

function renderGallery(onPick = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <TemplatesGallery onPick={onPick} />
    </I18nProvider>,
  );
}

it('renders one button per template', () => {
  renderGallery();
  expect(screen.getByText('Notify on high-priority row')).toBeTruthy();
  expect(screen.getByText('Auto-assign on @mention')).toBeTruthy();
  expect(screen.getByText('Archive when status = Done')).toBeTruthy();
});

it('clicking a template calls onPick with that template built model', () => {
  const onPick = vi.fn();
  renderGallery(onPick);
  fireEvent.click(screen.getByText('Archive when status = Done'));
  const archive = BUILDER_TEMPLATES.find((t) => t.id === 'archive-on-done');
  if (!archive) throw new Error('missing template');
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ triggerEvent: 'row.updated' }));
});
