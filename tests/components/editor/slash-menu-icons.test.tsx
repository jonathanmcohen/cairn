// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { Heading1 } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { SlashMenu } from '@/components/editor/slash-menu';

afterEach(cleanup);

describe('<SlashMenu> icons', () => {
  it('renders the item icon when provided', () => {
    const { container } = render(
      <SlashMenu
        items={[
          {
            title: 'Heading 1',
            description: 'x',
            category: 'basic',
            command: () => {},
            icon: Heading1,
          },
        ]}
        command={() => {}}
      />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
