// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '@/../messages/en.json';
import { ImageView } from '@/components/editor/blocks/image-view';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

const props = {
  node: { attrs: { src: 'https://x.test/a.png', alt: 'A photo' } },
  editor: { isEditable: true },
  updateAttributes: () => {},
} as never;

describe('<ImageView> single-image lightbox', () => {
  it('opens a portal dialog when the resolved image is activated', () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <ImageView {...(props as Parameters<typeof ImageView>[0])} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open image full screen' }));
    expect(document.body.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();
  });
});
