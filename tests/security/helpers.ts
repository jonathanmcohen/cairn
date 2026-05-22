import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

/** True if a table exists in the connected DB (gates v0.5.0-only surfaces). */
export async function tableExists(
  db: PostgresJsDatabase<typeof schema>,
  table: string,
): Promise<boolean> {
  const rows = (await db.execute(
    sql`SELECT to_regclass(${`public.${table}`}) AS reg`,
  )) as unknown as Array<{ reg: string | null }>;
  return rows[0]?.reg != null;
}

/** The fully-seeded id bag for workspace B that the isolation table consumes. */
export type SeededIds = {
  workspaceId: string;
  pageId: string;
  databaseId: string;
  propertyId: string;
  rowId: string;
  viewId: string;
  commentId: string;
  fileId: string;
  notificationId: string;
  apiKeyId: string;
  webhookId: string;
  templateId: string;
  pageVersionId: string;
};

/** A single HTTP attempt against a real route handler. */
export type RouteAttempt = {
  /** import the real route module + name the exported method to call */
  run: (b: SeededIds) => Promise<Response>;
};

/**
 * Every workspace-scoped resource the isolation suite walks. A cross-workspace
 * read (and, where applicable, mutation) of each MUST be denied without leaking
 * B's existence/data — concretely a 404 (or 401 for the unsigned file route).
 *
 * `requires` names the DB table that must exist for the case to run; rows whose
 * table is absent are skipped (v0.5.0 surfaces: api_keys/webhooks/templates/
 * page_versions). To cover a NEW resource type later, add one row here.
 *
 * Each attempt imports the project's real route module and calls the real
 * exported handler with the real `{ params: Promise<...> }` shape — there is no
 * central router, so the case carries its own dispatch.
 */
export type IsolationCase = {
  name: string;
  /** table that must exist for this case to run; undefined = always run */
  requires?: string;
  /** allowed denial statuses (default [404]); files allow 401 too */
  expect?: number[];
  /** cross-tenant read of B's resource */
  read: RouteAttempt;
  /** optional cross-tenant mutation of B's resource */
  mutate?: RouteAttempt;
};

function jsonReq(url: string, method: string, body?: unknown): Request {
  return new Request(`http://t${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export const ISOLATION_CASES: IsolationCase[] = [
  {
    name: 'pages',
    read: {
      run: async (b) => {
        const m = await import('@/app/api/pages/[pageId]/route');
        return m.GET(jsonReq(`/api/pages/${b.pageId}`, 'GET'), {
          params: Promise.resolve({ pageId: b.pageId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/pages/[pageId]/route');
        return m.PATCH(jsonReq(`/api/pages/${b.pageId}`, 'PATCH', { title: 'pwned' }), {
          params: Promise.resolve({ pageId: b.pageId }),
        });
      },
    },
  },
  {
    name: 'page delete',
    read: {
      run: async (b) => {
        const m = await import('@/app/api/pages/[pageId]/route');
        return m.GET(jsonReq(`/api/pages/${b.pageId}`, 'GET'), {
          params: Promise.resolve({ pageId: b.pageId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/pages/[pageId]/route');
        return m.DELETE(jsonReq(`/api/pages/${b.pageId}`, 'DELETE'), {
          params: Promise.resolve({ pageId: b.pageId }),
        });
      },
    },
  },
  {
    name: 'databases',
    read: {
      run: async (b) => {
        const m = await import('@/app/api/databases/[databaseId]/route');
        return m.GET(jsonReq(`/api/databases/${b.databaseId}`, 'GET'), {
          params: Promise.resolve({ databaseId: b.databaseId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/databases/[databaseId]/route');
        return m.PATCH(jsonReq(`/api/databases/${b.databaseId}`, 'PATCH', { name: 'pwned' }), {
          params: Promise.resolve({ databaseId: b.databaseId }),
        });
      },
    },
  },
  {
    name: 'db properties',
    read: {
      // properties listing rides the database GET (which returns properties)
      run: async (b) => {
        const m = await import('@/app/api/databases/[databaseId]/route');
        return m.GET(jsonReq(`/api/databases/${b.databaseId}`, 'GET'), {
          params: Promise.resolve({ databaseId: b.databaseId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/databases/[databaseId]/properties/[propId]/route');
        return m.PATCH(
          jsonReq(`/api/databases/${b.databaseId}/properties/${b.propertyId}`, 'PATCH', {
            name: 'pwned',
          }),
          { params: Promise.resolve({ databaseId: b.databaseId, propId: b.propertyId }) },
        );
      },
    },
  },
  {
    name: 'db rows',
    read: {
      // no GET-by-id row route; the database GET is the read surface
      run: async (b) => {
        const m = await import('@/app/api/databases/[databaseId]/route');
        return m.GET(jsonReq(`/api/databases/${b.databaseId}`, 'GET'), {
          params: Promise.resolve({ databaseId: b.databaseId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/databases/[databaseId]/rows/[rowId]/route');
        return m.PATCH(
          jsonReq(`/api/databases/${b.databaseId}/rows/${b.rowId}`, 'PATCH', { cells: {} }),
          { params: Promise.resolve({ databaseId: b.databaseId, rowId: b.rowId }) },
        );
      },
    },
  },
  {
    name: 'db views',
    read: {
      run: async (b) => {
        const m = await import('@/app/api/databases/[databaseId]/route');
        return m.GET(jsonReq(`/api/databases/${b.databaseId}`, 'GET'), {
          params: Promise.resolve({ databaseId: b.databaseId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/databases/[databaseId]/views/[viewId]/route');
        return m.PATCH(
          jsonReq(`/api/databases/${b.databaseId}/views/${b.viewId}`, 'PATCH', { name: 'pwned' }),
          { params: Promise.resolve({ databaseId: b.databaseId, viewId: b.viewId }) },
        );
      },
    },
  },
  {
    name: 'comments',
    read: {
      run: async (b) => {
        const m = await import('@/app/api/pages/[pageId]/comments/route');
        return m.GET(jsonReq(`/api/pages/${b.pageId}/comments`, 'GET'), {
          params: Promise.resolve({ pageId: b.pageId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/comments/[commentId]/route');
        return m.DELETE(jsonReq(`/api/comments/${b.commentId}`, 'DELETE'), {
          params: Promise.resolve({ commentId: b.commentId }),
        });
      },
    },
  },
  {
    name: 'files',
    // Unsigned cross-tenant read → 401 (no HMAC), never B's bytes.
    expect: [401, 404],
    read: {
      run: async (b) => {
        const m = await import('@/app/api/files/[fileId]/route');
        return m.GET(jsonReq(`/api/files/${b.fileId}`, 'GET'), {
          params: Promise.resolve({ fileId: b.fileId }),
        });
      },
    },
  },
  {
    name: 'notifications',
    // No GET/PATCH-by-id route; the list route is the read surface and the
    // /read POST is the mutate surface. Both are scoped to (userId, workspaceId)
    // so B's notification is invisible: list excludes it, /read updates 0 rows.
    read: {
      run: async (_b) => {
        const m = await import('@/app/api/notifications/route');
        return m.GET(jsonReq('/api/notifications', 'GET'));
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/notifications/read/route');
        return m.POST(jsonReq('/api/notifications/read', 'POST', { id: b.notificationId }));
      },
    },
  },
  // ---- v0.5.0 surfaces (skipped automatically if the table is absent) ----
  {
    name: 'api keys',
    requires: 'api_keys',
    read: {
      // no GET-by-id; DELETE is the only id-scoped surface
      run: async (b) => {
        const m = await import('@/app/api/api-keys/[id]/route');
        return m.DELETE(jsonReq(`/api/api-keys/${b.apiKeyId}`, 'DELETE'), {
          params: Promise.resolve({ id: b.apiKeyId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/api-keys/[id]/route');
        return m.DELETE(jsonReq(`/api/api-keys/${b.apiKeyId}`, 'DELETE'), {
          params: Promise.resolve({ id: b.apiKeyId }),
        });
      },
    },
  },
  {
    name: 'webhooks',
    requires: 'webhooks',
    read: {
      run: async (b) => {
        const m = await import('@/app/api/webhooks/[id]/route');
        return m.PATCH(jsonReq(`/api/webhooks/${b.webhookId}`, 'PATCH', { active: false }), {
          params: Promise.resolve({ id: b.webhookId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/webhooks/[id]/route');
        return m.DELETE(jsonReq(`/api/webhooks/${b.webhookId}`, 'DELETE'), {
          params: Promise.resolve({ id: b.webhookId }),
        });
      },
    },
  },
  {
    name: 'templates',
    requires: 'templates',
    read: {
      run: async (b) => {
        const m = await import('@/app/api/templates/[id]/route');
        return m.DELETE(jsonReq(`/api/templates/${b.templateId}`, 'DELETE'), {
          params: Promise.resolve({ id: b.templateId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/templates/[id]/route');
        return m.DELETE(jsonReq(`/api/templates/${b.templateId}`, 'DELETE'), {
          params: Promise.resolve({ id: b.templateId }),
        });
      },
    },
  },
  {
    name: 'page versions',
    requires: 'page_versions',
    read: {
      run: async (b) => {
        const m = await import('@/app/api/pages/[pageId]/versions/route');
        return m.GET(jsonReq(`/api/pages/${b.pageId}/versions`, 'GET'), {
          params: Promise.resolve({ pageId: b.pageId }),
        });
      },
    },
    mutate: {
      run: async (b) => {
        const m = await import('@/app/api/pages/[pageId]/versions/[versionId]/restore/route');
        return m.POST(
          jsonReq(`/api/pages/${b.pageId}/versions/${b.pageVersionId}/restore`, 'POST'),
          { params: Promise.resolve({ pageId: b.pageId, versionId: b.pageVersionId }) },
        );
      },
    },
  },
];
