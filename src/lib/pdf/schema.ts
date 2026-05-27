import { z } from 'zod';

/**
 * Normalized page-relative coordinates. Each component is in [0, 1] so the
 * overlay scales with any zoom factor. `w` and `h` may be zero on the wire
 * (e.g. a single-click "comment" pin), but the API + helper layer rejects
 * NaN / out-of-range values up-front.
 */
export const rectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const annotationKindSchema = z.enum(['highlight', 'comment', 'shape']);

export const createAnnotationInput = z.object({
  pageId: z.uuid(),
  fileId: z.uuid(),
  pageNumber: z.number().int().positive(),
  rect: rectSchema,
  kind: annotationKindSchema,
  content: z.string().max(4000).nullable(),
});

export const updateAnnotationInput = z.object({
  rect: rectSchema.optional(),
  content: z.string().max(4000).nullable().optional(),
});

export type Rect = z.infer<typeof rectSchema>;
export type AnnotationKind = z.infer<typeof annotationKindSchema>;
export type CreateAnnotationInput = z.infer<typeof createAnnotationInput>;
export type UpdateAnnotationInput = z.infer<typeof updateAnnotationInput>;
