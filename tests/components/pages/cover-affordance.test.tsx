// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoverPicker } from '@/components/pages/cover-picker';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

// Mock next/navigation router.refresh used by CoverPicker's save fallback.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

describe('CoverPicker affordance', () => {
  it('renders the Add cover trigger and opens the picker dialog on click', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <CoverPicker pageId="p1" current={{}} />
      </I18nProvider>,
    );
    const trigger = screen.getByRole('button', { name: /add cover/i });
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: /page cover/i })).toBeTruthy();
  });
});
