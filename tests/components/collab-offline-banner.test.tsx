// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CollabOfflineBanner } from '@/components/editor/collab-offline-banner';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json';

afterEach(cleanup);

function renderBanner(status: 'connecting' | 'connected' | 'disconnected' | 'error') {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <CollabOfflineBanner status={status} />
    </I18nProvider>,
  );
}

describe('CollabOfflineBanner', () => {
  it('renders nothing when connected', () => {
    renderBanner('connected');
    expect(screen.queryByText('Collab offline — reconnecting…')).toBeNull();
  });

  it('renders nothing while connecting', () => {
    renderBanner('connecting');
    expect(screen.queryByText('Collab offline — reconnecting…')).toBeNull();
  });

  it('shows the reconnecting message when disconnected', () => {
    renderBanner('disconnected');
    expect(screen.getByText('Collab offline — reconnecting…')).not.toBeNull();
  });

  it('shows the banner on error status too', () => {
    renderBanner('error');
    expect(screen.getByText('Collab offline — reconnecting…')).not.toBeNull();
  });

  it('uses an aria-live polite region with an accessible label', () => {
    renderBanner('error');
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-label')).toBe('Collaboration status');
  });

  it('hides after the dismiss button is clicked', () => {
    renderBanner('disconnected');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Collab offline — reconnecting…')).toBeNull();
  });
});
