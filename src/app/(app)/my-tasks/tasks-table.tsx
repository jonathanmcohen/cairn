'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type TasksTableRow = {
  pageId: string;
  workspaceId: string;
  blockId: string;
  text: string;
  checked: boolean;
  dueAtIso: string | null;
  pageTitle: string;
  pageIcon: string | null;
};

const STATUSES = ['open', 'done', 'all'] as const;
type Status = (typeof STATUSES)[number];

export function TasksTable(props: {
  initialTasks: TasksTableRow[];
  initialStatus: Status;
  initialDue?: string;
}): React.ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [tasks, setTasks] = useState<TasksTableRow[]>(props.initialTasks);

  const setQuery = (patch: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => router.replace(`/my-tasks?${next.toString()}` as Route));
  };

  const toggle = async (pageId: string, blockId: string): Promise<void> => {
    setTasks((prev) =>
      prev.map((t) =>
        t.pageId === pageId && t.blockId === blockId ? { ...t, checked: !t.checked } : t,
      ),
    );
    const res = await fetch(`/api/pages/${pageId}/tasks/${blockId}/toggle`, { method: 'POST' });
    if (!res.ok) {
      setTasks((prev) =>
        prev.map((t) =>
          t.pageId === pageId && t.blockId === blockId ? { ...t, checked: !t.checked } : t,
        ),
      );
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <fieldset className="flex flex-wrap gap-2" aria-label="Filter by status">
        <legend className="sr-only">Filter by status</legend>
        {STATUSES.map((s) => (
          <Button
            key={s}
            variant={props.initialStatus === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setQuery({ status: s })}
          >
            {s}
          </Button>
        ))}
        <Input
          type="date"
          className="ml-auto w-40"
          value={props.initialDue ?? ''}
          aria-label="Due by"
          onChange={(e) => setQuery({ due: e.target.value || null })}
        />
      </fieldset>
      <ul className="divide-y rounded border">
        {tasks.length === 0 && (
          <li className="p-4 text-center text-muted-foreground text-sm">No tasks.</li>
        )}
        {tasks.map((t) => (
          <li key={`${t.pageId}-${t.blockId}`} className="flex items-center gap-3 p-3">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={t.checked}
              onChange={() => toggle(t.pageId, t.blockId)}
              aria-label={`Toggle ${t.text}`}
            />
            <span className={t.checked ? 'text-muted-foreground line-through' : ''}>{t.text}</span>
            <Link
              href={`/pages/${t.pageId}` as Route}
              className="ml-auto text-muted-foreground text-sm hover:underline"
            >
              {t.pageIcon ? `${t.pageIcon} ` : ''}
              {t.pageTitle}
            </Link>
            {t.dueAtIso && (
              <time className="text-muted-foreground text-xs" dateTime={t.dueAtIso}>
                due {t.dueAtIso.slice(0, 10)}
              </time>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
