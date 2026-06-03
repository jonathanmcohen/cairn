// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EquationAddDialog } from '@/components/editor/blocks/equation-add-dialog';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

// The dialog renders a live KaTeX preview via renderMath; mock it so the test
// asserts the wiring without depending on KaTeX's exact HTML output.
vi.mock('@/lib/editor/math-render', () => ({
  renderMath: (latex: string) => `<span class="katex">RENDERED:${latex}</span>`,
}));

afterEach(() => cleanup());

function renderDialog(onInsert: (latex: string, display: boolean) => void) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      <EquationAddDialog open onClose={() => {}} onInsert={onInsert} />
    </I18nProvider>,
  );
}

describe('<EquationAddDialog>', () => {
  it('renders a live KaTeX preview and inserts the collected latex + display flag', () => {
    const onInsert = vi.fn();
    renderDialog(onInsert);

    const field = screen.getByLabelText('LaTeX') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: '\\frac{1}{2}' } });

    const preview = screen.getByTestId('equation-preview');
    expect(preview.innerHTML).toContain('RENDERED:\\frac{1}{2}');

    // Display toggle starts checked (block); leave it on.
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onInsert).toHaveBeenCalledWith('\\frac{1}{2}', true);
  });

  it('toggles display off before inserting', () => {
    const onInsert = vi.fn();
    renderDialog(onInsert);

    fireEvent.change(screen.getByLabelText('LaTeX'), { target: { value: 'x^2' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onInsert).toHaveBeenCalledWith('x^2', false);
  });
});
