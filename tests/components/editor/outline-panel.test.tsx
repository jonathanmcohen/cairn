// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutlinePanel } from '@/components/editor/outline-panel';

vi.mock('@/lib/editor/headings', () => ({
  collectHeadings: () => [{ id: 'h1', level: 1, text: 'Intro' }],
}));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

const fakeEditor = {
  state: { doc: { toJSON: () => ({}) } },
  view: { dom: document.createElement('div') },
  on: () => {},
  off: () => {},
} as unknown as import('@tiptap/react').Editor;

describe('<OutlinePanel> as flyout', () => {
  it('renders an overlay aside that does not consume layout flow (absolute/fixed positioned)', () => {
    render(<OutlinePanel editor={fakeEditor} onClose={() => {}} />);
    const aside = screen.getByRole('complementary', { name: /outline/i });
    expect(aside.className).toMatch(/absolute|fixed/);
  });
});
