'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Img = { src: string; alt: string };

/**
 * Portal-mounted modal lightbox for the gallery block.
 *
 * - Renders via `createPortal(... document.body)` so it escapes any clipping
 *   ancestor `overflow-hidden` (the editor surface scrolls in a clipped div).
 * - `role="dialog"` + `aria-modal="true"` + `aria-label` carrying the
 *   position; the underlying ProseMirror is functionally inert while the
 *   dialog is open because keystrokes are intercepted on `window`.
 * - On mount, captures the previously focused element and focuses the dialog;
 *   on unmount, restores focus so screen-reader users return to the thumbnail
 *   they activated.
 * - Keyboard nav: `←`/`→` cycle (wrapping), `+`/`-` zoom (clamped 0.25..4),
 *   `Esc` closes.
 *
 * v0.9.0 G3 P16.
 */
export function Lightbox({
  images,
  startIndex,
  onClose,
}: {
  images: Img[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [scale, setScale] = useState(1);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<Element | null>(null);

  // Capture previously focused element and focus the dialog on mount; restore
  // on unmount so closing the lightbox returns focus to the trigger.
  useEffect(() => {
    previousFocus.current = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus.current instanceof HTMLElement) {
        previousFocus.current.focus();
      }
    };
  }, []);

  // Keyboard handlers — bound to window so the dialog is functionally modal
  // regardless of which element holds DOM focus inside it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowRight':
          e.preventDefault();
          setIndex((i) => (i + 1) % images.length);
          setScale(1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setIndex((i) => (i - 1 + images.length) % images.length);
          setScale(1);
          break;
        case '+':
        case '=':
          e.preventDefault();
          setScale((s) => Math.min(s + 0.25, 4));
          break;
        case '-':
          e.preventDefault();
          setScale((s) => Math.max(s - 0.25, 0.25));
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [images.length, onClose]);

  if (typeof document === 'undefined') return null;
  const current = images[index];
  if (!current) return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Image ${index + 1} of ${images.length}`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 outline-hidden"
    >
      {/* Backdrop: click closes. `aria-hidden` keeps it out of the AT tree. */}
      <button
        type="button"
        data-testid="lightbox-backdrop"
        className="absolute inset-0 cursor-default bg-transparent"
        onClick={onClose}
        aria-label="Close lightbox"
        tabIndex={-1}
      />
      <div className="relative z-10 flex max-h-full max-w-full items-center justify-center p-4">
        {/* biome-ignore lint/performance/noImgElement: portal-mounted modal — next/image is not suitable. */}
        <img
          src={current.src}
          alt={current.alt}
          style={{ transform: `scale(${scale})`, transition: 'transform 120ms ease' }}
          className="max-h-[85vh] max-w-[90vw] origin-center"
        />
      </div>
      <div className="relative z-10 mt-2 flex items-center gap-4 text-sm text-white">
        <button
          type="button"
          className="rounded p-2 hover:bg-white/10"
          onClick={() => {
            setIndex((i) => (i - 1 + images.length) % images.length);
            setScale(1);
          }}
          aria-label="Previous image"
        >
          {'<'}
        </button>
        <span aria-live="polite">
          {index + 1} / {images.length}
        </span>
        <button
          type="button"
          className="rounded p-2 hover:bg-white/10"
          onClick={() => {
            setIndex((i) => (i + 1) % images.length);
            setScale(1);
          }}
          aria-label="Next image"
        >
          {'>'}
        </button>
        <span className="ml-4 text-xs text-white/60">+/- to zoom · Esc to close</span>
      </div>
    </div>,
    document.body,
  );
}
