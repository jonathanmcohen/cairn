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
  keywords: [],
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
    // group headers present (decorative presentation nodes) — scoped to the
    // listbox since the P9 category rail repeats the same labels outside it.
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Basic')).toBeTruthy();
    expect(within(listbox).getByText('Media')).toBeTruthy();
    expect(within(listbox).getByText('Advanced')).toBeTruthy();
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

describe('<SlashMenu> category rail (P9)', () => {
  it('renders one rail button per NON-EMPTY group, in fixed order, outside the listbox', () => {
    render(<SlashMenu items={sample} command={vi.fn()} />);
    const rail = screen.getByTestId('slash-category-rail');
    const buttons = within(rail).getAllByRole('button');
    // sample has no 'workspace' items — no Workspace rail entry.
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Basic',
      'Media',
      'Database',
      'Advanced',
    ]);
    // Rail buttons stay OUT of the ARIA option machinery: not options, not
    // tabbable, and not nested inside the listbox element.
    const listbox = screen.getByRole('listbox');
    for (const b of buttons) {
      expect(b.getAttribute('tabindex')).toBe('-1');
      expect(b.getAttribute('role')).not.toBe('option');
      expect(listbox.contains(b)).toBe(false);
    }
    // Option count is unchanged by the rail (flat keyboard index coherent).
    expect(screen.getAllByRole('option')).toHaveLength(sample.length);
  });

  it('hides the rail when filtering leaves a single non-empty group', () => {
    render(
      <SlashMenu items={[mk('Heading 1', 'basic'), mk('Quote', 'basic')]} command={vi.fn()} />,
    );
    expect(screen.queryByTestId('slash-category-rail')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('rail click scrolls the listbox scroller to the group header (not the page)', () => {
    render(<SlashMenu items={sample} command={vi.fn()} />);
    const listbox = screen.getByRole('listbox');
    // jsdom doesn't implement Element#scrollTo — install a spy on the
    // scroller instance and assert the jump targets IT (page never scrolled).
    const scrollSpy = vi.fn();
    listbox.scrollTo = scrollSpy as unknown as typeof listbox.scrollTo;
    screen.getByTestId('slash-rail-advanced').click();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ top: expect.any(Number) });
  });

  it('highlights the rail entry for the active option as keyboard nav crosses groups', () => {
    const ref = createRef<SlashMenuRef>();
    render(<SlashMenu ref={ref} items={sample} command={vi.fn()} />);
    // index 0 = 'Heading 1' (basic)
    expect(screen.getByTestId('slash-rail-basic').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('slash-rail-media').getAttribute('data-active')).toBeNull();
    // ArrowDown twice: Heading 1 -> Quote (basic) -> Image (media)
    act(() => {
      ref.current?.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    act(() => {
      ref.current?.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    expect(screen.getByTestId('slash-rail-media').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('slash-rail-basic').getAttribute('data-active')).toBeNull();
  });
});
