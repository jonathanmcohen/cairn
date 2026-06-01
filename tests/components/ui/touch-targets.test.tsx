// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

afterEach(cleanup);

describe('touch targets', () => {
  it('default Button is at least 40px tall (h-10)', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button').className).toContain('h-10');
  });

  it('auth-size Button hits the 44px floor (h-11)', () => {
    render(<Button size="auth">Sign in</Button>);
    expect(screen.getByRole('button').className).toContain('h-11');
  });

  it('icon Button is at least 40px square (size-10)', () => {
    render(<Button size="icon" aria-label="x" />);
    expect(screen.getByRole('button').className).toContain('size-10');
  });

  it('Input is at least 40px tall (h-10)', () => {
    render(<Input aria-label="field" />);
    expect(screen.getByLabelText('field').className).toContain('h-10');
  });
});
