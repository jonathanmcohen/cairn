// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PasswordInput } from '@/components/ui/password-input';

afterEach(cleanup);

describe('<PasswordInput>', () => {
  it('starts masked and toggles to text when the eye button is pressed', () => {
    render(
      <PasswordInput
        aria-label="Link password"
        showLabel="Show password"
        hideLabel="Hide password"
      />,
    );
    const input = screen.getByLabelText('Link password') as HTMLInputElement;
    expect(input.type).toBe('password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    // the toggle is now the "hide" affordance and reports pressed state
    const pressed = screen.getByRole('button', { name: 'Hide password' });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
  });
});
