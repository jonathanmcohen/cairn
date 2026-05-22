import { describe, expect, it } from 'vitest';
import { renderMath } from '@/lib/editor/math-render';

describe('renderMath', () => {
  it('renders simple inline latex to KaTeX HTML', () => {
    const html = renderMath('x^2');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('class="katex-display"');
  });

  it('renders block latex in display mode', () => {
    const html = renderMath('\\int_0^1 x\\,dx', true);
    expect(html).toContain('class="katex-display"');
  });

  it('does not throw on invalid latex — returns an inline error span', () => {
    const html = renderMath('\\frac{');
    expect(html).toContain('katex-error');
  });

  it('renders a placeholder for empty input rather than nothing', () => {
    const html = renderMath('');
    expect(html).toContain('class="katex"');
  });

  it('is pure: same input yields identical output', () => {
    expect(renderMath('a+b')).toBe(renderMath('a+b'));
  });
});
