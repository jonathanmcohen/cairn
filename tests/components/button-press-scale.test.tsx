// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';

afterEach(cleanup);

describe('button press-scale (#10)', () => {
  it('renders the reduced-motion-safe active scale', () => {
    render(<Button>Save</Button>);
    const cls = screen.getByRole('button', { name: 'Save' }).className;
    expect(cls).toMatch(/active:scale-\[0\.98\]/);
    expect(cls).toMatch(/motion-reduce:active:scale-100/);
  });
});
