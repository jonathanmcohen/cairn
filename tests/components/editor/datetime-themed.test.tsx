// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DateTimeView } from '@/components/editor/extensions/datetime';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

afterEach(cleanup);

describe('<DateTimeView> themed editor popover (#38)', () => {
  it('opens a popover with a themed timezone Select and DateField (no native select/date)', () => {
    const { container } = render(
      <DateTimeView
        node={{ attrs: { iso: '2026-01-02T09:30', tz: 'UTC', display_format: '' } }}
        updateAttributes={() => {}}
        viewerTz="UTC"
      />,
    );
    // The trigger is the only button before the popover opens.
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('input[type="date"]')).toBeNull();
    // time stays native (no themed time primitive) but is allowed
    expect(container.querySelector('input[type="time"]')).not.toBeNull();
    expect(screen.getByRole('combobox', { name: /timezone/i })).toBeTruthy();
  });
});
