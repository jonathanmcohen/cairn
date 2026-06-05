// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EmptyBacklinks,
  EmptyInbox,
  EmptyRecents,
  EmptySearch,
} from '@/components/empty-state/variants';

// copy() reads flat-key i18n; stub to identity so the test is locale-agnostic.
vi.mock('@/lib/copy/messages', () => ({ copy: (k: string) => k }));

afterEach(cleanup);

describe('icon-less empty states get icons (#11)', () => {
  it.each([
    ['search', <EmptySearch key="s" />],
    ['inbox', <EmptyInbox key="i" />],
    ['backlinks', <EmptyBacklinks key="b" />],
    ['recents', <EmptyRecents key="r" />],
  ])('%s renders an svg icon', (_name, el) => {
    const { container } = render(el);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
