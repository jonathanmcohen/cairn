/**
 * Shared Zod schemas for /api/v1/pages.
 *
 * Importing from `@/lib/openapi/decorators` ensures `.openapi()` is available
 * on every Zod type — the call to `extendZodWithOpenApi(z)` is side-effecting.
 */
import { z } from '@/lib/openapi/decorators';

export const PageId = z.uuid().openapi({
  description: 'Page UUID',
  example: '123e4567-e89b-12d3-a456-426614174000',
});

export const PageTitle = z.string().min(1).max(200).openapi({
  description: 'Page title shown in the sidebar and meta.',
  example: 'Project kickoff notes',
});

export const PageIcon = z.string().max(8).openapi({
  description: 'A short emoji or 1-2 character icon shown in the sidebar.',
  example: 'NOTE',
});

export const CreatePageRequest = z
  .object({
    parentId: PageId.optional(),
    title: PageTitle.optional(),
    icon: PageIcon.optional(),
  })
  .openapi({ description: 'Create a new page within the caller workspace.' });

export const UpdatePageRequest = z
  .object({
    title: PageTitle.optional(),
    content: z.unknown().optional().openapi({
      description: 'ProseMirror/TipTap JSON document.',
    }),
    icon: PageIcon.nullable().optional(),
  })
  .openapi({ description: 'Patch a page. Only provided fields are updated.' });

export const PageListItem = z.object({
  id: PageId,
  title: z.string().nullable(),
  parentId: PageId.nullable(),
  icon: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const PageListResponse = z
  .object({
    items: z.array(PageListItem),
    nextCursor: z.string().nullable(),
  })
  .openapi({ description: 'Cursor-paginated list of pages.' });

export const PageDetailResponse = z
  .object({
    id: PageId,
    workspaceId: z.uuid(),
    title: z.string().nullable(),
    parentId: PageId.nullable(),
    icon: z.string().nullable(),
    content: z.unknown().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi({ description: 'Full page detail including content JSON.' });

export const ListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
  })
  .openapi({ description: 'Cursor pagination parameters.' });
