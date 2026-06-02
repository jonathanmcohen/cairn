// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IconTooltip, TooltipProvider } from '@/components/ui/tooltip';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
      NoopResizeObserver;
  }
});

afterEach(cleanup);

describe('IconTooltip', () => {
  it('renders the trigger and keeps its own aria-label untouched', () => {
    render(
      <TooltipProvider>
        <IconTooltip label="Comments">
          <button type="button" aria-label="Comments">
            x
          </button>
        </IconTooltip>
      </TooltipProvider>,
    );
    const btn = screen.getByRole('button');
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Comments');
  });

  it('reveals the tooltip content on focus', async () => {
    render(
      <TooltipProvider>
        <IconTooltip label="Comments">
          <button type="button" aria-label="Comments">
            x
          </button>
        </IconTooltip>
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByRole('button'));
    expect(await screen.findAllByText('Comments')).not.toHaveLength(0);
  });
});
