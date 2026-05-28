// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Sparkline } from '@/app/(app)/settings/admin/api-keys/sparkline';

afterEach(() => {
  cleanup();
});

describe('Sparkline', () => {
  it('renders an SVG path with one M + N L commands', () => {
    const { container } = render(<Sparkline values={[1, 2, 3, 4]} />);
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    const d = path?.getAttribute('d') ?? '';
    expect(d.startsWith('M')).toBe(true);
    // 1 M + 3 L for 4 points
    expect((d.match(/L /g) ?? []).length).toBe(3);
  });

  it('handles all-zero input without throwing', () => {
    const { container } = render(<Sparkline values={[0, 0, 0]} />);
    expect(container.querySelector('path')).not.toBeNull();
  });

  it('has aria-label with sum + day count', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toContain('6');
    expect(svg?.getAttribute('aria-label')).toContain('3');
  });

  it('renders a fallback svg for empty values', () => {
    const { container } = render(<Sparkline values={[]} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(container.querySelector('path')).toBeNull();
  });
});
