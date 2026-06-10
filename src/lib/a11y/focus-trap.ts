'use client';

import { useEffect, useRef } from 'react';

/**
 * Shared focus-trap primitive for modal surfaces (the sidebar drawer, dialogs,
 * menus). This is the SINGLE focus-trap utility — the v0.6.0 accessibility plan
 * (P14) reuses `useFocusTrap` for the share dialog, command palette, and other
 * modals rather than re-implementing trapping per component.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Tabbable elements inside `container`, in DOM order. Pure — no side effects. */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(nodes).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * While `active`, traps keyboard focus inside the returned ref's element:
 * focuses the first focusable child on activation, wraps Tab / Shift+Tab at the
 * edges, and restores focus to the previously-focused element on deactivation.
 * Attach the returned ref to the trap container.
 *
 * `restoreFocus` (default true): on deactivation, return focus to whatever was
 * focused before the trap engaged. Pass false when the caller owns focus
 * restoration itself (e.g. the editor dialogs refocus the ProseMirror view in a
 * layout effect — v0.9.19 A2/#76 — and the trap's own restore would otherwise
 * refocus <body> a frame later and drop the user's next keystrokes).
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
  restoreFocus = true,
) {
  const ref = useRef<T | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null;

    const focusFirst = () => {
      const focusable = getFocusable(container);
      (focusable[0] ?? container).focus();
    };
    focusFirst();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement;
      if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      if (restoreFocus) previouslyFocused.current?.focus?.();
    };
  }, [active, restoreFocus]);

  return ref;
}
