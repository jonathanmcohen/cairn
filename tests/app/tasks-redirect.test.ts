import { describe, expect, it, vi } from 'vitest';

const permanentRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ permanentRedirect, redirect }));

describe('/tasks route', () => {
  it('permanently redirects to /my-tasks', async () => {
    const mod = await import('@/app/(app)/tasks/page');
    expect(() => mod.default()).toThrow('REDIRECT:/my-tasks');
  });
});
