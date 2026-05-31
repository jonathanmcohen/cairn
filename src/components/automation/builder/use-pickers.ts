'use client';

import { useEffect, useState } from 'react';

export type Option = { value: string; label: string };

function useFetchOptions(url: string | null, map: (json: unknown) => Option[]) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(url !== null);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `map` is a stable inline closure per hook; only `url` drives a refetch.
  useEffect(() => {
    if (url === null) {
      setOptions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: unknown) => {
        if (!cancelled) setOptions(map(json));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { options, loading, error };
}

export function useDatabases() {
  return useFetchOptions('/api/databases', (json) => {
    const list = (json as { databases?: Array<{ id: string; title: string }> }).databases ?? [];
    return list.map((d) => ({ value: d.id, label: d.title }));
  });
}

export function useProperties(databaseId: string | null) {
  // GET /api/databases/:id returns the database meta with an embedded
  // `properties: [{ id, name, ... }]` array (there is no standalone properties
  // GET endpoint). Read that array for the picker.
  return useFetchOptions(databaseId ? `/api/databases/${databaseId}` : null, (json) => {
    const list = (json as { properties?: Array<{ id: string; name: string }> }).properties ?? [];
    return list.map((p) => ({ value: p.id, label: p.name }));
  });
}

export function useTemplates() {
  return useFetchOptions('/api/templates', (json) => {
    const list = (json as { templates?: Array<{ id: string; name: string }> }).templates ?? [];
    return list.map((t) => ({ value: t.id, label: t.name }));
  });
}

export function useWebhooks() {
  return useFetchOptions('/api/webhooks', (json) => {
    const list = (json as { webhooks?: Array<{ id: string; url: string }> }).webhooks ?? [];
    return list.map((w) => ({ value: w.id, label: w.url }));
  });
}

export function usePages() {
  return useFetchOptions('/api/pages/tree', (json) => {
    const list = (json as { nodes?: Array<{ id: string; title: string }> }).nodes ?? [];
    return list.map((n) => ({ value: n.id, label: n.title || n.id }));
  });
}

export function useMembers(query: string) {
  return useFetchOptions(`/api/workspaces/members?q=${encodeURIComponent(query)}`, (json) => {
    const list =
      (
        json as {
          members?: Array<{
            userId?: string;
            id?: string;
            name?: string | null;
            email?: string;
          }>;
        }
      ).members ?? [];
    return list.map((m) => ({
      value: m.userId ?? m.id ?? '',
      label: m.name ?? m.email ?? m.userId ?? m.id ?? '',
    }));
  });
}
