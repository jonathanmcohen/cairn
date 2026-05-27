// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VersionDiffViewer } from '@/app/(app)/pages/[pageId]/versions/diff/viewer';
import type { DiffBlock, PMNode } from '@/lib/pages/version-diff';

const fixedDate = new Date('2026-01-01T00:00:00Z');
const para = (text: string): PMNode => ({
  type: 'paragraph',
  attrs: {},
  content: [{ type: 'text', text }],
});

afterEach(() => {
  cleanup();
});

describe('<VersionDiffViewer>', () => {
  it('renders unchanged blocks once per side', () => {
    const diff: DiffBlock[] = [{ kind: 'unchanged', index: 0, block: para('hello') }];
    render(
      <VersionDiffViewer
        diff={diff}
        snapshotA={{
          id: 'a',
          createdAt: fixedDate,
          content: { type: 'doc', content: [para('hello')] },
        }}
        snapshotB={{
          id: 'b',
          createdAt: fixedDate,
          content: { type: 'doc', content: [para('hello')] },
        }}
      />,
    );
    expect(screen.getAllByText('hello')).toHaveLength(2);
  });

  it('renders an added block green on right, placeholder on left', () => {
    const diff: DiffBlock[] = [{ kind: 'added', index: 0, block: para('new') }];
    render(
      <VersionDiffViewer
        diff={diff}
        snapshotA={{ id: 'a', createdAt: fixedDate, content: { type: 'doc', content: [] } }}
        snapshotB={{
          id: 'b',
          createdAt: fixedDate,
          content: { type: 'doc', content: [para('new')] },
        }}
      />,
    );
    const right = screen.getByTestId('diff-row-0').querySelector('[data-side="right"]');
    expect(right?.textContent).toContain('new');
    expect(right?.className).toMatch(/added|bg-green/);
  });

  it('renders a removed block red on left, placeholder on right', () => {
    const diff: DiffBlock[] = [{ kind: 'removed', index: 0, block: para('gone') }];
    render(
      <VersionDiffViewer
        diff={diff}
        snapshotA={{
          id: 'a',
          createdAt: fixedDate,
          content: { type: 'doc', content: [para('gone')] },
        }}
        snapshotB={{ id: 'b', createdAt: fixedDate, content: { type: 'doc', content: [] } }}
      />,
    );
    const left = screen.getByTestId('diff-row-0').querySelector('[data-side="left"]');
    expect(left?.textContent).toContain('gone');
    expect(left?.className).toMatch(/removed|bg-red/);
  });

  it('collapses runs of >= 4 unchanged blocks into a single toggle', () => {
    const diff: DiffBlock[] = Array.from({ length: 5 }, (_, i) => ({
      kind: 'unchanged' as const,
      index: i,
      block: para(`row-${i}`),
    }));
    render(
      <VersionDiffViewer
        diff={diff}
        snapshotA={{
          id: 'a',
          createdAt: fixedDate,
          content: { type: 'doc', content: diff.map((d) => d.block) },
        }}
        snapshotB={{
          id: 'b',
          createdAt: fixedDate,
          content: { type: 'doc', content: diff.map((d) => d.block) },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /5 identical blocks/i })).toBeTruthy();
    expect(screen.queryByText('row-2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /5 identical blocks/i }));
    expect(screen.getAllByText('row-2')).toHaveLength(2);
  });

  it('does NOT collapse a run of 3 unchanged blocks (threshold is 4)', () => {
    const diff: DiffBlock[] = Array.from({ length: 3 }, (_, i) => ({
      kind: 'unchanged' as const,
      index: i,
      block: para(`row-${i}`),
    }));
    render(
      <VersionDiffViewer
        diff={diff}
        snapshotA={{
          id: 'a',
          createdAt: fixedDate,
          content: { type: 'doc', content: diff.map((d) => d.block) },
        }}
        snapshotB={{
          id: 'b',
          createdAt: fixedDate,
          content: { type: 'doc', content: diff.map((d) => d.block) },
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: /identical blocks/i })).toBeNull();
    expect(screen.getAllByText('row-1')).toHaveLength(2);
  });

  it('renders inline diff tokens for a changed block', () => {
    const diff: DiffBlock[] = [
      {
        kind: 'changed',
        oldIndex: 0,
        newIndex: 0,
        before: para('the quick fox'),
        after: para('the slow fox'),
        inlineDiff: [
          { kind: 'same', text: 'the' },
          { kind: 'same', text: ' ' },
          { kind: 'remove', text: 'quick' },
          { kind: 'add', text: 'slow' },
          { kind: 'same', text: ' ' },
          { kind: 'same', text: 'fox' },
        ],
      },
    ];
    render(
      <VersionDiffViewer
        diff={diff}
        snapshotA={{
          id: 'a',
          createdAt: fixedDate,
          content: { type: 'doc', content: [para('the quick fox')] },
        }}
        snapshotB={{
          id: 'b',
          createdAt: fixedDate,
          content: { type: 'doc', content: [para('the slow fox')] },
        }}
      />,
    );
    const removed = screen.getByText('quick');
    const added = screen.getByText('slow');
    expect(removed.className).toMatch(/inline-remove|bg-red/);
    expect(added.className).toMatch(/inline-add|bg-green/);
  });
});
