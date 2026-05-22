// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getFocusable, useFocusTrap } from '@/lib/a11y/focus-trap';

// The repo's vitest config does not enable `globals`, so @testing-library/react
// cannot auto-register its afterEach cleanup. Without it, repeated render()
// calls accumulate in document.body and getByTestId finds duplicate elements.
afterEach(cleanup);

describe('getFocusable', () => {
  it('returns tabbable elements in DOM order, skipping disabled + tabindex=-1', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <a href="#one">one</a>
      <button>two</button>
      <button disabled>skip-disabled</button>
      <input />
      <div tabindex="-1">skip-negative</div>
      <div tabindex="0">five</div>
    `;
    const els = getFocusable(root);
    // `||` (not `??`): an empty <input> has textContent === '' (not null) in
    // jsdom, so we fall back to tagName for it to assert 'INPUT'.
    expect(els.map((e) => e.textContent || e.tagName)).toEqual(['one', 'two', 'INPUT', 'five']);
  });

  it('returns an empty array for a container with nothing focusable', () => {
    const root = document.createElement('div');
    root.innerHTML = `<p>just text</p><span aria-hidden="true">x</span>`;
    expect(getFocusable(root)).toEqual([]);
  });
});

function Trap({ active }: { active: boolean }) {
  const trapRef = useFocusTrap(active);
  return (
    <div>
      <button type="button" data-testid="outside">
        outside
      </button>
      <div ref={trapRef} data-testid="trap">
        <button type="button" data-testid="first">
          first
        </button>
        <button type="button" data-testid="last">
          last
        </button>
      </div>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element when activated', () => {
    const { getByTestId } = render(<Trap active />);
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('wraps Tab from the last element back to the first', () => {
    const { getByTestId } = render(<Trap active />);
    const last = getByTestId('last');
    last.focus();
    fireEvent.keyDown(getByTestId('trap'), { key: 'Tab' });
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('wraps Shift+Tab from the first element back to the last', () => {
    const { getByTestId } = render(<Trap active />);
    const first = getByTestId('first');
    first.focus();
    fireEvent.keyDown(getByTestId('trap'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getByTestId('last'));
  });

  it('restores focus to the previously-focused element when deactivated', () => {
    const { getByTestId, rerender } = render(<Trap active={false} />);
    const outside = getByTestId('outside');
    outside.focus();
    expect(document.activeElement).toBe(outside);
    rerender(<Trap active />);
    expect(document.activeElement).toBe(getByTestId('first'));
    rerender(<Trap active={false} />);
    expect(document.activeElement).toBe(outside);
  });

  it('does nothing while inactive', () => {
    const { getByTestId } = render(<Trap active={false} />);
    expect(document.activeElement).not.toBe(getByTestId('first'));
  });
});
