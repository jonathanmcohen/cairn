// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MentionList, type MentionListRef } from '@/components/editor/mention-list';

afterEach(cleanup);

describe('<MentionList>', () => {
  it('shows an avatar fallback initial for a member without an image', () => {
    render(
      <MentionList
        ref={createRef<MentionListRef>()}
        items={[{ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null }]}
        command={() => {}}
      />,
    );
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('AL')).toBeTruthy(); // initials fallback
  });
});
