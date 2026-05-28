/**
 * Shared Zod schemas for /api/v1/databases.
 *
 * Side-effect import of `@/lib/openapi/decorators` brings `.openapi()` into
 * scope on every Zod type.
 */
import { z } from '@/lib/openapi/decorators';
import { ListQuery, PageId } from './pages';

export { ListQuery };

export const DatabaseId = z.uuid().openapi({
  description: 'Inline-database UUID',
  example: '987e6543-e21b-32d3-c456-426614174abc',
});

export const RowId = z.uuid().openapi({
  description: 'Database row UUID',
  example: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
});

export const DatabaseName = z.string().min(1).max(200).openapi({
  description: 'Database name.',
  example: 'Tasks',
});

export const CreateDatabaseRequest = z
  .object({
    pageId: PageId,
    name: DatabaseName.optional(),
  })
  .openapi({ description: 'Create a new inline database, attached to a page.' });

export const UpdateDatabaseRequest = z
  .object({
    name: DatabaseName.optional(),
  })
  .openapi({ description: 'Patch a database. Only provided fields are updated.' });

export const DatabaseListItem = z.object({
  id: DatabaseId,
  name: z.string().nullable(),
  pageId: PageId,
  createdAt: z.iso.datetime(),
});

export const DatabaseListResponse = z
  .object({
    items: z.array(DatabaseListItem),
    nextCursor: z.string().nullable(),
  })
  .openapi({ description: 'Cursor-paginated list of databases.' });

export const DatabaseDetailResponse = z
  .object({
    database: z.object({
      id: DatabaseId,
      workspaceId: z.uuid(),
      pageId: PageId,
      name: z.string().nullable(),
      createdAt: z.iso.datetime(),
      archivedAt: z.iso.datetime().nullable(),
    }),
    properties: z.array(z.unknown()),
    views: z.array(z.unknown()),
  })
  .openapi({ description: 'Database, its properties, and view definitions.' });

export const CellValues = z.record(z.string(), z.unknown()).openapi({
  description: 'Map of property-id → cell value. Values are type-coerced server-side.',
});

export const CreateRowRequest = z
  .object({
    cells: CellValues.optional(),
  })
  .openapi({ description: 'Create a new row in the database.' });

export const UpdateRowRequest = z
  .object({
    cells: CellValues,
  })
  .openapi({ description: 'Update the cell values of a row.' });

export const RowListItem = z.object({
  id: RowId,
  databaseId: DatabaseId,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const RowListResponse = z
  .object({
    items: z.array(RowListItem),
    nextCursor: z.string().nullable(),
  })
  .openapi({ description: 'Cursor-paginated list of rows.' });

export const RowDetailResponse = z
  .object({
    row: RowListItem,
    cells: CellValues,
  })
  .openapi({ description: 'Row metadata plus its cell map.' });

export const EmptyResponse = z.object({}).openapi({ description: 'Empty body — 204 No Content.' });
