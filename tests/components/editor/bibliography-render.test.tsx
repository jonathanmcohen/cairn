// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Bibliography } from '@/components/editor/extensions/bibliography';

describe('Bibliography', () => {
  it('renders dedup ordered list in active style', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'citation',
          attrs: {
            id: 'a',
            formatted_apa: 'Aaa apa',
            formatted_mla: 'Aaa mla',
            formatted_chicago: 'Aaa chi',
          },
        },
        {
          type: 'citation',
          attrs: {
            id: 'b',
            formatted_apa: 'Bbb apa',
            formatted_mla: 'Bbb mla',
            formatted_chicago: 'Bbb chi',
          },
        },
        {
          type: 'citation',
          attrs: {
            id: 'a',
            formatted_apa: 'Aaa apa',
            formatted_mla: 'Aaa mla',
            formatted_chicago: 'Aaa chi',
          },
        },
      ],
    };
    render(<Bibliography doc={doc} style="mla" />);
    expect(screen.getByRole('heading', { name: /references/i })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(['Aaa mla', 'Bbb mla']);
  });

  it('renders nothing when no citations present', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    const { container } = render(<Bibliography doc={doc} style="apa" />);
    expect(container.firstChild).toBeNull();
  });
});
