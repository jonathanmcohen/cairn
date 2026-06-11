'use client';

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { hasOnboarded } from '@/components/onboarding/storage';
import {
  mountedProgress,
  nextMountedStep,
  STEPS,
  type TourPlacement,
} from '@/components/tour/steps';
import { hasSeenTour, markTourSeen } from '@/components/tour/storage';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.10.0 F3 — element-anchored onboarding tour. A lightweight fixed-position
 * popover (no new dep) that points at real UI via `[data-tour]` hooks, driven
 * by the STEPS list. Auto-starts once per workspace (localStorage marker, see
 * ./storage.ts) when the full-screen onboarding wizard is NOT showing, and can
 * be replayed anytime via the sidebar Help button, which dispatches the
 * `cairn:start-tour` CustomEvent.
 */

const START_TOUR_EVENT = 'cairn:start-tour';
const GAP = 12;
const VIEWPORT_MARGIN = 8;

type Rect = { top: number; left: number; width: number; height: number };

/**
 * First VISIBLE match for the selector. `querySelectorAll` (not
 * `querySelector`) because some anchors render twice — the desktop aside and
 * the mobile drawer both mount SidebarContent — and only one instance has
 * client rects at any viewport size.
 */
function findAnchor(selector: string): Element | null {
  for (const el of Array.from(document.querySelectorAll(selector))) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

function isMounted(selector: string): boolean {
  return findAnchor(selector) !== null;
}

function placeCard(
  anchor: Rect,
  card: { width: number; height: number },
  placement: TourPlacement,
): { top: number; left: number } {
  let top: number;
  let left: number;
  switch (placement) {
    case 'right':
      top = anchor.top;
      left = anchor.left + anchor.width + GAP;
      break;
    case 'left':
      top = anchor.top;
      left = anchor.left - card.width - GAP;
      break;
    case 'bottom':
      top = anchor.top + anchor.height + GAP;
      left = anchor.left;
      break;
    case 'top':
      top = anchor.top - card.height - GAP;
      left = anchor.left;
      break;
  }
  // Clamp to the viewport with an 8px margin.
  left = Math.min(
    Math.max(left, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - card.width - VIEWPORT_MARGIN),
  );
  top = Math.min(
    Math.max(top, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, window.innerHeight - card.height - VIEWPORT_MARGIN),
  );
  return { top, left };
}

export function OnboardingTour({
  workspaceId,
  hasAnyUserPages,
}: {
  workspaceId: string;
  hasAnyUserPages: boolean;
}) {
  const t = useT();
  // null = closed; otherwise an index into STEPS (always a mounted anchor).
  const [index, setIndex] = useState<number | null>(null);
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const focusedOnOpenRef = useRef(false);

  const start = useCallback(() => {
    const first = nextMountedStep(STEPS, -1, isMounted);
    if (first === -1) return; // nothing anchored anywhere — never show detached
    // NOTE: deliberately no anchorRect/pos reset here. If the tour is already
    // open at `first`, resetting would blank the card without re-running the
    // [index]-keyed effects; stale values are recomputed before paint anyway.
    setIndex(first);
  }, []);

  // Auto-start on first load. Mirror-inverts the wizard's show condition
  // (wizard.tsx is active when `!hasAnyUserPages && !hasOnboarded(ws)`) so the
  // two first-run surfaces never stack on top of each other.
  useEffect(() => {
    if (!hasAnyUserPages && !hasOnboarded(workspaceId)) return; // wizard owns this run
    if (hasSeenTour(workspaceId)) return;
    start();
  }, [workspaceId, hasAnyUserPages, start]);

  // Help re-trigger: replays the tour regardless of the seen-marker.
  useEffect(() => {
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, [start]);

  // Track the current step's anchor rect; recompute on resize/scroll (passive,
  // capture so nested scroll containers reposition the card too). A missing
  // anchor at step entry is skipped forward; if none remain the tour just ends
  // (no seen-marker — only Done/Skip/Esc mark it).
  useEffect(() => {
    if (index === null) return;
    const step = STEPS[index];
    if (!step) return;
    const el = findAnchor(step.anchor);
    if (!el) {
      const next = nextMountedStep(STEPS, index, isMounted);
      setIndex(next === -1 ? null : next);
      return;
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      setAnchorRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, { capture: true });
    };
  }, [index]);

  // Position the card once it (and the anchor rect) exist. A plain effect (not
  // useLayoutEffect — avoids the SSR warning): the card renders at opacity 0
  // until positioned, so the one-frame placement delay is invisible.
  useEffect(() => {
    if (index === null || anchorRect === null) return;
    const step = STEPS[index];
    const card = cardRef.current;
    if (!step || !card) return;
    const { width, height } = card.getBoundingClientRect();
    setPos(placeCard(anchorRect, { width, height }, step.placement));
  }, [index, anchorRect]);

  // Focus the popover card when the tour OPENS (after it is positioned, so the
  // focus isn't swallowed by a still-hidden element). Step changes keep focus
  // where the user put it (e.g. on the Next button).
  useEffect(() => {
    if (index === null) {
      focusedOnOpenRef.current = false;
      return;
    }
    if (pos !== null && !focusedOnOpenRef.current) {
      focusedOnOpenRef.current = true;
      cardRef.current?.focus();
    }
  }, [index, pos]);

  const dismiss = useCallback(() => {
    markTourSeen(workspaceId);
    setIndex(null);
  }, [workspaceId]);

  // Esc anywhere = Skip (dismiss + mark seen).
  useEffect(() => {
    if (index === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, dismiss]);

  function goNext() {
    if (index === null) return;
    const next = nextMountedStep(STEPS, index, isMounted);
    if (next === -1) {
      // Done — last mounted step completed.
      markTourSeen(workspaceId);
      setIndex(null);
    } else {
      setIndex(next);
    }
  }

  function goBack() {
    if (index === null) return;
    const prev = nextMountedStep(STEPS, index, isMounted, -1);
    if (prev !== -1) setIndex(prev);
  }

  // Trap Tab/Shift+Tab between the card's controls. Enter activates the
  // focused button natively (no global Enter binding).
  function onCardKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return;
    const card = cardRef.current;
    if (!card) return;
    const focusables = Array.from(card.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (focusables.length === 0) return;
    e.preventDefault();
    const active = document.activeElement;
    const idx = focusables.findIndex((el) => el === active);
    let target: HTMLElement | undefined;
    if (idx === -1) {
      target = e.shiftKey ? focusables[focusables.length - 1] : focusables[0];
    } else {
      const delta = e.shiftKey ? -1 : 1;
      target = focusables[(idx + delta + focusables.length) % focusables.length];
    }
    target?.focus();
  }

  if (index === null) return null;
  const step = STEPS[index];
  if (!step) return null;

  // Render-time reads are safe here: this branch only renders client-side
  // (index starts null, so SSR always returns null above).
  const hasPrev = nextMountedStep(STEPS, index, isMounted, -1) !== -1;
  const isLast = nextMountedStep(STEPS, index, isMounted) === -1;
  const progress = mountedProgress(STEPS, index, isMounted);
  const titleId = `cairn-tour-title-${step.id}`;

  return (
    <>
      {anchorRect ? (
        <div
          aria-hidden="true"
          data-tour-highlight=""
          className="pointer-events-none fixed z-50 rounded-md border-2 border-primary transition-opacity duration-150 motion-reduce:transition-none"
          style={{
            top: anchorRect.top,
            left: anchorRect.left,
            width: anchorRect.width,
            height: anchorRect.height,
          }}
        />
      ) : null}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        data-tour-dialog=""
        tabIndex={-1}
        onKeyDown={onCardKeyDown}
        className="fixed z-50 w-80 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, opacity: 0 }}
      >
        <h2 id={titleId} className="text-sm font-semibold">
          {t(step.titleKey)}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(step.bodyKey)}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {t('tour.progress', { current: progress.current, total: progress.total })}
          </span>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
              {t('tour.skip')}
            </Button>
            {hasPrev ? (
              <Button type="button" variant="outline" size="sm" onClick={goBack}>
                {t('tour.back')}
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={goNext}>
              {isLast ? t('tour.done') : t('tour.next')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
