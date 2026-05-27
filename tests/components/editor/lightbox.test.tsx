// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lightbox } from '@/components/editor/lightbox';

afterEach(() => cleanup());

const fixtures = [
  { src: 'a.png', alt: 'A' },
  { src: 'b.png', alt: 'B' },
  { src: 'c.png', alt: 'C' },
];

// Lightbox binds its keydown listener on `window`, so we dispatch the events
// to `window` instead of a specific element — matches how the modal handles
// focus-trapped input in real usage. `act(...)` wraps the dispatch so React
// flushes the resulting state updates before assertions read the DOM.
function press(key: string) {
  act(() => {
    fireEvent.keyDown(window, { key });
  });
}

describe('Lightbox', () => {
  it('renders the start image and shows position counter', () => {
    render(<Lightbox images={fixtures} startIndex={1} onClose={() => {}} />);
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByAltText('B')).toBeTruthy();
  });

  it('arrow keys cycle through images (wrapping)', () => {
    render(<Lightbox images={fixtures} startIndex={0} onClose={() => {}} />);
    expect(screen.getByText('1 / 3')).toBeTruthy();
    press('ArrowRight');
    expect(screen.getByText('2 / 3')).toBeTruthy();
    press('ArrowRight');
    press('ArrowRight');
    // Wraps to 1
    expect(screen.getByText('1 / 3')).toBeTruthy();
    press('ArrowLeft');
    expect(screen.getByText('3 / 3')).toBeTruthy();
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<Lightbox images={fixtures} startIndex={0} onClose={onClose} />);
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop calls onClose', () => {
    const onClose = vi.fn();
    render(<Lightbox images={fixtures} startIndex={0} onClose={onClose} />);
    const backdrop = screen.getByTestId('lightbox-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('zoom in / out updates the transform scale', () => {
    render(<Lightbox images={fixtures} startIndex={0} onClose={() => {}} />);
    const img = screen.getByAltText('A') as HTMLImageElement;
    expect(img.style.transform).toContain('scale(1)');
    press('+');
    expect(img.style.transform).toContain('scale(1.25)');
    press('-');
    expect(img.style.transform).toContain('scale(1)');
  });

  it('restores focus to the originally focused element on close', () => {
    const Trigger = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
            open
          </button>
          {open && <Lightbox images={fixtures} startIndex={0} onClose={() => setOpen(false)} />}
        </>
      );
    };
    render(<Trigger />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    act(() => {
      fireEvent.click(trigger);
    });
    // Close via Esc.
    press('Escape');
    expect(document.activeElement).toBe(trigger);
  });

  it('exposes role=dialog + aria-modal + aria-label including position', () => {
    render(<Lightbox images={fixtures} startIndex={0} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toMatch(/Image 1 of 3/);
  });
});
