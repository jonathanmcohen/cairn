// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { FlowConnector } from '@/components/automation/builder/flow-connector';

afterEach(cleanup);

it('renders a connector element', () => {
  render(<FlowConnector />);
  expect(screen.getByTestId('flow-connector')).toBeTruthy();
});

it('the branch variant adds a distinguishing dashed-border class', () => {
  const { container } = render(<FlowConnector variant="branch" />);
  const el = container.querySelector('[data-testid="flow-connector"]');
  expect(el?.className).toContain('border-dashed');
});
