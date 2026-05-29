// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

afterEach(cleanup);

describe('<Select>', () => {
  it('renders the trigger with the placeholder and a themed class', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Status">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Status' });
    expect(trigger).toBeTruthy();
    expect(trigger.className).toContain('bg-background');
  });
});
