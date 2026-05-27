/**
 * Source-of-truth manifest mapping every stable public v1 route to the Zod
 * schemas it accepts and returns. Adding a new /api/v1/* route means adding a
 * row here — `tests/openapi/route-coverage.test.ts` keeps us honest.
 *
 * Scope rule: only `src/app/api/v1/**` routes are documented. Admin internals
 * and unversioned legacy routes are intentionally excluded from the spec.
 */

import {
  CreateDatabaseRequest,
  CreateRowRequest,
  DatabaseDetailResponse,
  DatabaseListResponse,
  EmptyResponse,
  ListQuery,
  RowDetailResponse,
  RowListResponse,
  UpdateDatabaseRequest,
  UpdateRowRequest,
} from '@/lib/schemas/databases';
import {
  CreatePageRequest,
  PageDetailResponse,
  PageListResponse,
  UpdatePageRequest,
} from '@/lib/schemas/pages';
import type { z } from './decorators';

export type ManifestEntry = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** OpenAPI path — Next.js `[param]` becomes `{param}`. */
  path: string;
  summary: string;
  tags: string[];
  requestSchema?: z.ZodTypeAny;
  querySchema?: z.ZodTypeAny;
  responseSchema?: z.ZodTypeAny;
  /** Default `['pat']` — the /api/v1 surface is PAT-bearer-token gated. */
  security?: Array<'session' | 'pat'>;
  /** Path params declared as `[name]` in the Next.js route folder. */
  pathParams?: string[];
  /** Status code of the primary success response. */
  successStatus?: number;
};

export const manifest: ManifestEntry[] = [
  // --- Pages ---
  {
    method: 'GET',
    path: '/api/v1/pages',
    summary: 'List pages in the caller workspace',
    tags: ['Pages'],
    querySchema: ListQuery,
    responseSchema: PageListResponse,
    security: ['pat'],
    successStatus: 200,
  },
  {
    method: 'POST',
    path: '/api/v1/pages',
    summary: 'Create a page',
    tags: ['Pages'],
    requestSchema: CreatePageRequest,
    responseSchema: PageDetailResponse,
    security: ['pat'],
    successStatus: 201,
  },
  {
    method: 'GET',
    path: '/api/v1/pages/{pageId}',
    summary: 'Get a page by id',
    tags: ['Pages'],
    pathParams: ['pageId'],
    responseSchema: PageDetailResponse,
    security: ['pat'],
    successStatus: 200,
  },
  {
    method: 'PATCH',
    path: '/api/v1/pages/{pageId}',
    summary: 'Update a page',
    tags: ['Pages'],
    pathParams: ['pageId'],
    requestSchema: UpdatePageRequest,
    responseSchema: PageDetailResponse,
    security: ['pat'],
    successStatus: 200,
  },
  {
    method: 'DELETE',
    path: '/api/v1/pages/{pageId}',
    summary: 'Soft-delete a page (move to trash)',
    tags: ['Pages'],
    pathParams: ['pageId'],
    responseSchema: EmptyResponse,
    security: ['pat'],
    successStatus: 204,
  },

  // --- Databases ---
  {
    method: 'GET',
    path: '/api/v1/databases',
    summary: 'List inline databases in the caller workspace',
    tags: ['Databases'],
    querySchema: ListQuery,
    responseSchema: DatabaseListResponse,
    security: ['pat'],
    successStatus: 200,
  },
  {
    method: 'POST',
    path: '/api/v1/databases',
    summary: 'Create an inline database',
    tags: ['Databases'],
    requestSchema: CreateDatabaseRequest,
    responseSchema: DatabaseDetailResponse,
    security: ['pat'],
    successStatus: 201,
  },
  {
    method: 'GET',
    path: '/api/v1/databases/{databaseId}',
    summary: 'Get a database by id',
    tags: ['Databases'],
    pathParams: ['databaseId'],
    responseSchema: DatabaseDetailResponse,
    security: ['pat'],
    successStatus: 200,
  },
  {
    method: 'PATCH',
    path: '/api/v1/databases/{databaseId}',
    summary: 'Update a database',
    tags: ['Databases'],
    pathParams: ['databaseId'],
    requestSchema: UpdateDatabaseRequest,
    responseSchema: DatabaseDetailResponse,
    security: ['pat'],
    successStatus: 200,
  },
  {
    method: 'DELETE',
    path: '/api/v1/databases/{databaseId}',
    summary: 'Archive a database',
    tags: ['Databases'],
    pathParams: ['databaseId'],
    responseSchema: EmptyResponse,
    security: ['pat'],
    successStatus: 204,
  },

  // --- Database rows ---
  {
    method: 'GET',
    path: '/api/v1/databases/{databaseId}/rows',
    summary: 'List rows in a database',
    tags: ['Databases'],
    pathParams: ['databaseId'],
    querySchema: ListQuery,
    responseSchema: RowListResponse,
    security: ['pat'],
    successStatus: 200,
  },
  {
    method: 'POST',
    path: '/api/v1/databases/{databaseId}/rows',
    summary: 'Create a row',
    tags: ['Databases'],
    pathParams: ['databaseId'],
    requestSchema: CreateRowRequest,
    responseSchema: RowDetailResponse,
    security: ['pat'],
    successStatus: 201,
  },
  {
    method: 'GET',
    path: '/api/v1/databases/{databaseId}/rows/{rowId}',
    summary: 'Get a row by id',
    tags: ['Databases'],
    pathParams: ['databaseId', 'rowId'],
    responseSchema: RowDetailResponse,
    security: ['pat'],
    successStatus: 200,
  },
  {
    method: 'PATCH',
    path: '/api/v1/databases/{databaseId}/rows/{rowId}',
    summary: 'Update row cell values',
    tags: ['Databases'],
    pathParams: ['databaseId', 'rowId'],
    requestSchema: UpdateRowRequest,
    responseSchema: RowDetailResponse,
    security: ['pat'],
    successStatus: 200,
  },
  {
    method: 'DELETE',
    path: '/api/v1/databases/{databaseId}/rows/{rowId}',
    summary: 'Archive a row',
    tags: ['Databases'],
    pathParams: ['databaseId', 'rowId'],
    responseSchema: EmptyResponse,
    security: ['pat'],
    successStatus: 204,
  },
];
