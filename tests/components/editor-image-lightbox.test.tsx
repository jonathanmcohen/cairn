// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '@/../messages/en.json';
import { ImageView } from '@/components/editor/blocks/image-view';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

const node = { attrs: { src: 'https://x.test/a.png', alt: 'A photo' } } as never;
const editor = { isEditable: true } as never;

describe('<ImageView> single-image lightbox', () => {
  it('opens a portal dialog when the resolved image is activated', () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <ImageView node={node} editor={editor} updateAttributes={() => {}} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open image full screen' }));
    expect(document.body.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();
  });
});
