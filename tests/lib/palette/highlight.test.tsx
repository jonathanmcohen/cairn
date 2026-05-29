// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { highlightMatch } from '@/lib/palette/highlight';

afterEach(cleanup);

describe('highlightMatch', () => {
  it('wraps each case-insensitive match in a <mark>', () => {
    render(<span>{highlightMatch('Roadmap roadwork', 'road')}</span>);
    const marks = screen.getAllByText(/road/i, { selector: 'mark' });
    expect(marks).toHaveLength(2);
  });

  it('returns the text unchanged when query is empty', () => {
    render(<span data-testid="t">{highlightMatch('Plain title', '')}</span>);
    expect(screen.getByTestId('t').querySelector('mark')).toBeNull();
    expect(screen.getByTestId('t').textContent).toBe('Plain title');
  });

  it('does not treat query as a regex (escapes special chars)', () => {
    render(<span data-testid="t">{highlightMatch('a.b.c', '.')}</span>);
    // Only the literal dots match, not every char.
    expect(screen.getByTestId('t').querySelectorAll('mark')).toHaveLength(2);
  });
});
