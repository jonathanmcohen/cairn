// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Lightbox } from '@/components/editor/lightbox';

afterEach(() => cleanup());

/**
 * v0.9.0 G3 P16 — JSDOM-level a11y smoke for the gallery's lightbox modal.
 *
 * The full WCAG 2.1 AA gate runs via Playwright + @axe-core/playwright in
 * tests/a11y/*.spec.ts. This file is the unit-level companion — cheap
 * structural checks (roles, labels, focusable controls) that catch
 * regressions without spinning up a browser. `vitest-axe` is intentionally
 * NOT a dep (see tests/a11y/pinned-pages.test.tsx).
 */
describe('a11y: Lightbox (JSDOM smoke)', () => {
  const fixtures = [
    { src: 'a.png', alt: 'Image A description' },
    { src: 'b.png', alt: 'Image B description' },
  ];

  it('exposes role=dialog + aria-modal + aria-label including position', () => {
    render(<Lightbox images={fixtures} startIndex={0} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toMatch(/Image 1 of 2/);
  });

  it('every interactive control has an accessible name', () => {
    render(<Lightbox images={fixtures} startIndex={0} onClose={() => {}} />);
    // Prev / Next / Close (backdrop) buttons are all labeled.
    expect(screen.getByRole('button', { name: /Previous image/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Next image/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Close lightbox/i })).toBeTruthy();
  });

  it('rendered image carries the supplied alt text (no empty alt)', () => {
    render(<Lightbox images={fixtures} startIndex={1} onClose={() => {}} />);
    const img = screen.getByAltText('Image B description');
    expect(img.tagName.toLowerCase()).toBe('img');
    expect(img.getAttribute('alt')).not.toBe('');
  });

  it('position counter is an aria-live region (polite)', () => {
    // Lightbox portals into document.body, so look there instead of the
    // container render returns.
    render(<Lightbox images={fixtures} startIndex={0} onClose={() => {}} />);
    const live = document.body.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(live?.textContent).toMatch(/1 \/ 2/);
  });
});
