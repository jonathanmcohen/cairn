// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Skeleton } from '@/components/ui/skeleton';

afterEach(cleanup);

describe('Skeleton primitive (#16)', () => {
  it('renders a reduced-motion-safe pulsing block and forwards className', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toMatch(/animate-pulse/);
    expect(el.className).toMatch(/motion-reduce:animate-none/);
    expect(el.className).toMatch(/bg-muted/);
    expect(el.className).toMatch(/h-4/);
    expect(el.className).toMatch(/w-32/);
  });
});
