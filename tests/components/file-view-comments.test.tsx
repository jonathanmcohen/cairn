// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { NodeViewProps } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReactNodeViewRenderer: () => () => null,
}));
vi.mock('@/components/comments/file-comments', () => ({
  FileComments: (p: { fileId: string }) => <div data-testid="file-comments">{p.fileId}</div>,
}));

import { FileView } from '@/components/editor/blocks/file-view';

afterEach(cleanup);

function makeProps(fileId: string | null): NodeViewProps {
  return {
    node: { attrs: { href: 'https://x/file', name: 'doc.pdf', fileId } },
    editor: { isEditable: true },
    updateAttributes: () => {},
  } as unknown as NodeViewProps;
}

describe('<FileView> comments disclosure', () => {
  it('renders a Comments toggle when fileId is present', () => {
    render(<FileView {...makeProps('file-123')} />);
    expect(screen.getByRole('button', { name: 'Comments' })).toBeTruthy();
  });

  it('mounts FileComments for the resolved fileId on toggle', () => {
    render(<FileView {...makeProps('file-123')} />);
    expect(screen.queryByTestId('file-comments')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    expect(screen.getByTestId('file-comments').textContent).toBe('file-123');
  });

  it('does not render the Comments toggle when fileId is absent', () => {
    render(<FileView {...makeProps(null)} />);
    expect(screen.queryByRole('button', { name: 'Comments' })).toBeNull();
  });
});
