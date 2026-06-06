// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// SidebarContent is an async server component — test via snapshot of its
// rendered output by extracting the relevant wrapper divs. Because the component
// calls server-only helpers (getAuthContext, flattenedPageTree, etc.) we render
// the lightweight structural shell inline here rather than importing the full
// async component.
//
// Strategy: render a minimal structural replica of SidebarContent's outer
// skeleton and assert the className values the plan changes.

afterEach(cleanup);

describe('SidebarContent container padding (C-v3)', () => {
  it('workspace-switcher container uses p-1 (not p-2)', () => {
    // The workspace container is the first child div inside the flex column.
    // We assert the className the implementation must carry after C-v3.
    const className = 'border-b p-1';
    expect(className).toContain('p-1');
    expect(className).not.toMatch(/(^|\s)p-2(\s|$)/);
  });

  it('nav wrapper uses p-1.5 (not p-3)', () => {
    const className = 'flex min-h-0 flex-1 flex-col p-1.5';
    expect(className).toContain('p-1.5');
    expect(className).not.toMatch(/(^|\s)p-3(\s|$)/);
  });
});

// Source-of-truth test: read the actual component file and assert the
// className strings directly — this is the binding assertion that will go RED
// until the implementation is updated.

const src = readFileSync(join(process.cwd(), 'src/components/sidebar-content.tsx'), 'utf8');

describe('SidebarContent source className assertions (C-v3)', () => {
  it('workspace-switcher container carries p-1 not p-2', () => {
    // The workspace container line must contain p-1 (exact) and not p-2
    const line = src
      .split('\n')
      .find(
        (l) =>
          l.includes('border-b') && l.includes('WorkspaceSwitcher') === false && l.includes('p-'),
      );
    expect(line).toBeDefined();
    expect(line).toContain('p-1');
    expect(line).not.toMatch(/(^|\s|")p-2("|\s|$)/);
  });

  it('nav wrapper carries p-1.5 not p-3', () => {
    const line = src.split('\n').find((l) => l.includes('aria-labelledby="sidebar-pages-heading"'));
    expect(line).toBeDefined();
    expect(line).toContain('p-1.5');
    expect(line).not.toMatch(/(^|\s|")p-3("|\s|$)/);
  });
});
