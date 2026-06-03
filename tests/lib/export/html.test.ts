import { expect, it } from 'vitest';
import { pageToHtml } from '@/lib/export/html';

const page = {
  id: 'p1',
  title: 'Hello <World>',
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body line' }] }],
  },
};

it('emits a standalone HTML doc with escaped title and body, no auto-print script (#56)', () => {
  const html = pageToHtml(page);
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('Hello &lt;World&gt;');
  expect(html).toContain('Body line');
  expect(html).not.toContain('window.print()');
});
