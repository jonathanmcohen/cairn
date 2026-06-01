// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  useDatabases,
  useTemplates,
  useWebhooks,
} from '@/components/automation/builder/use-pickers';

afterEach(() => vi.restoreAllMocks());

function mockJson(map: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = Object.keys(map).find((k) => url.includes(k));
    return new Response(JSON.stringify(key ? map[key] : {}), { status: 200 });
  });
}

it('useDatabases returns the databases list', async () => {
  mockJson({ '/api/databases': { databases: [{ id: 'd1', title: 'Tasks' }] } });
  const { result } = renderHook(() => useDatabases());
  await waitFor(() => expect(result.current.options).toHaveLength(1));
  expect(result.current.options[0]).toEqual({ value: 'd1', label: 'Tasks' });
});

it('useTemplates maps templates to options', async () => {
  mockJson({
    '/api/templates': { templates: [{ id: 't1', name: 'Meeting', kind: 'page', builtIn: true }] },
  });
  const { result } = renderHook(() => useTemplates());
  await waitFor(() => expect(result.current.options).toHaveLength(1));
  expect(result.current.options[0]?.label).toBe('Meeting');
});

it('useWebhooks maps webhooks to options by url', async () => {
  mockJson({
    '/api/webhooks': {
      webhooks: [{ id: 'w1', url: 'https://x.test/h', events: [], active: true, createdAt: '' }],
    },
  });
  const { result } = renderHook(() => useWebhooks());
  await waitFor(() => expect(result.current.options).toHaveLength(1));
  expect(result.current.options[0]?.label).toContain('x.test');
});
