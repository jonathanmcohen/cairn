// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CoverBanner } from '@/components/pages/cover-banner';

afterEach(cleanup);

describe('<CoverBanner> preset rendering (finding U)', () => {
  it('renders a gradient preset via backgroundImage', () => {
    const { container } = render(<CoverBanner cover={{ kind: 'preset', value: 'slate-dusk' }} />);
    const banner = container.querySelector('div[aria-hidden="true"]') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.style.backgroundImage).toContain('linear-gradient');
  });

  it('renders a neutral preset via backgroundColor', () => {
    const { container } = render(<CoverBanner cover={{ kind: 'preset', value: 'graphite' }} />);
    const banner = container.querySelector('div[aria-hidden="true"]') as HTMLElement;
    expect(banner).not.toBeNull();
    // jsdom normalizes hex → rgb in inline styles.
    expect(banner.style.backgroundColor).not.toBe('');
  });

  it('renders nothing for an unknown preset key', () => {
    const { container } = render(<CoverBanner cover={{ kind: 'preset', value: 'gone' }} />);
    expect(container.querySelector('div[aria-hidden="true"]')).toBeNull();
  });

  it('renders nothing for an empty cover', () => {
    const { container } = render(<CoverBanner cover={{}} />);
    expect(container.firstChild).toBeNull();
  });
});
