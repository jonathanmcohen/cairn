// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '@/../messages/en.json';
import { ConditionGroup } from '@/components/automation/builder/condition-group';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

describe('<ConditionGroup> remove button', () => {
  it('renders a lucide svg, not ✕', () => {
    const group = {
      combinator: 'and' as const,
      rows: [{ id: 'c1', property: '', operator: 'equals' as const, value: null }],
    };
    const { container } = render(
      <I18nProvider locale="en" messages={enMessages}>
        <ConditionGroup group={group} onChange={() => {}} />
      </I18nProvider>,
    );
    expect(container.textContent ?? '').not.toMatch(/✕/);
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
  });
});
