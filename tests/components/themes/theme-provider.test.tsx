// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '@/components/themes/theme-provider';
import { FONT_FAMILY_STACK, PAGE_WIDTH_PX } from '@/lib/themes/presets';

describe('ThemeProvider', () => {
  it('applies data-accent + custom properties for a named preset', () => {
    render(
      <ThemeProvider initialPrefs={{ accent: 'violet', fontFamily: 'serif', pageWidth: 'narrow' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = document.documentElement;
    expect(root.getAttribute('data-accent')).toBe('violet');
    expect(root.style.getPropertyValue('--cairn-font-family')).toBe(FONT_FAMILY_STACK.serif);
    expect(root.style.getPropertyValue('--cairn-page-width-max')).toBe(PAGE_WIDTH_PX.narrow);
  });

  it('applies a custom hex accent via --cairn-accent', () => {
    render(
      <ThemeProvider initialPrefs={{ accent: '#abcdef', fontFamily: 'system', pageWidth: 'wide' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = document.documentElement;
    expect(root.getAttribute('data-accent')).toBe('custom');
    expect(root.style.getPropertyValue('--cairn-accent')).toBe('#abcdef');
  });
});
