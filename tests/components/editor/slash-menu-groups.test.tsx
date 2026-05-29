// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  groupSlashItems,
  type SlashItem,
  SlashMenu,
  type SlashMenuRef,
} from '@/components/editor/slash-menu';

afterEach(cleanup);

const mk = (title: string, category: SlashItem['category']): SlashItem => ({
  title,
  description: `${title} desc`,
  category,
  command: vi.fn(),
});

const sample: SlashItem[] = [
  mk('Heading 1', 'basic'),
  mk('Image', 'media'),
  mk('Database', 'database'),
  mk('Equation', 'advanced'),
  mk('Quote', 'basic'),
];

describe('groupSlashItems', () => {
  it('partitions into fixed category order, dropping empties', () => {
    const groups = groupSlashItems(sample);
    expect(groups.map((g) => g.category)).toEqual(['basic', 'media', 'database', 'advanced']);
    // flatten preserves a stable permutation of the input
    const flat = groups.flatMap((g) => g.items.map((i) => i.title));
    expect(flat).toEqual(['Heading 1', 'Quote', 'Image', 'Database', 'Equation']);
  });
});

describe('<SlashMenu> grouped rendering + keyboard nav', () => {
  it('renders all items grouped (no 10-item cap) with category headers', () => {
    render(<SlashMenu items={sample} command={vi.fn()} />);
    // every item is discoverable as a selectable option (the "Database" item
    // title also matches a header label, so scope the lookup to options).
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(sample.length);
    // Each option title is rendered above its "<title> desc" line; assert the
    // title text is present within its own option (scoped to dodge the
    // "Database" header/item label collision).
    for (const it of sample) {
      const option = options.find((o) => within(o).queryByText(it.title));
      expect(option).toBeTruthy();
    }
    // group headers present (decorative presentation nodes)
    expect(screen.getByText('Basic')).toBeTruthy();
    expect(screen.getByText('Media')).toBeTruthy();
    expect(screen.getByText('Advanced')).toBeTruthy();
  });

  it('ArrowDown then Enter selects the second item in grouped flat order', () => {
    const command = vi.fn();
    const ref = createRef<SlashMenuRef>();
    render(<SlashMenu ref={ref} items={sample} command={command} />);
    // flat grouped order: Heading 1, Quote, Image, Database, Equation
    act(() => {
      ref.current?.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    act(() => {
      ref.current?.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ title: 'Quote' }));
  });
});
