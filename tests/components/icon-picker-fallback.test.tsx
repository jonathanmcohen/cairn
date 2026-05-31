// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IconPicker } from '@/components/icon-picker';

afterEach(cleanup);

describe('<IconPicker> fallback glyph', () => {
  it('renders a lucide svg (not 📄) when no icon is set', () => {
    render(<IconPicker value={null} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Change icon' });
    expect(trigger.textContent ?? '').not.toMatch(/📄|🖼️/);
    expect(trigger.querySelector('svg')).toBeTruthy();
  });

  it('still renders a chosen emoji as text content', () => {
    render(<IconPicker value="emoji::🪨" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Change icon' }).textContent).toContain('🪨');
  });
});
