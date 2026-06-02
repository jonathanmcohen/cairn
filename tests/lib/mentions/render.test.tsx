// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCommentBody } from '@/lib/mentions/render';

afterEach(cleanup);

const UUID = '11111111-1111-1111-1111-111111111111';
const UUID2 = '22222222-2222-2222-2222-222222222222';

describe('renderCommentBody (#72)', () => {
  it('renders a single mention as a pill and preserves surrounding text', () => {
    render(<p>{renderCommentBody(`Hello @[Jon](${UUID}) testing!`)}</p>);
    // The pill shows "@Jon" and carries the editor mention class.
    const pill = screen.getByText('@Jon');
    expect(pill.className).toContain('mention');
    // Surrounding text is preserved and the raw markdown token is gone.
    expect(screen.getByText(/Hello/)).toBeTruthy();
    expect(document.body.textContent).toContain('testing!');
    expect(document.body.textContent).not.toContain('@[');
    expect(document.body.textContent).not.toContain(`(${UUID})`);
  });

  it('renders zero mentions as plain text unchanged', () => {
    render(<p>{renderCommentBody('just plain text, no mentions')}</p>);
    expect(document.body.textContent).toBe('just plain text, no mentions');
    expect(document.querySelectorAll('.mention')).toHaveLength(0);
  });

  it('renders N mentions including adjacent ones', () => {
    render(<p>{renderCommentBody(`@[Ada](${UUID}) and @[Bob](${UUID2}) ship it`)}</p>);
    const pills = document.querySelectorAll('.mention');
    expect(pills).toHaveLength(2);
    expect(screen.getByText('@Ada')).toBeTruthy();
    expect(screen.getByText('@Bob')).toBeTruthy();
    expect(document.body.textContent).toContain('and');
    expect(document.body.textContent).toContain('ship it');
    expect(document.body.textContent).not.toContain('@[');
  });

  it('carries the mention id on a data attribute for each pill', () => {
    render(<p>{renderCommentBody(`hi @[Jon](${UUID})`)}</p>);
    const pill = document.querySelector('.mention');
    expect(pill?.getAttribute('data-mention-id')).toBe(UUID);
  });

  it('leaves a malformed (non-uuid) token as literal text', () => {
    render(<p>{renderCommentBody('weird @[Jon](not-a-uuid) here')}</p>);
    expect(document.querySelectorAll('.mention')).toHaveLength(0);
    expect(document.body.textContent).toContain('@[Jon](not-a-uuid)');
  });
});
