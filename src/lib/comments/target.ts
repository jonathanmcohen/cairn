import { z } from 'zod';

/** Enum string values stored in `comments.target_type` (matches the DB enum). */
export const COMMENT_TARGET_TYPES = ['page', 'db_row', 'file'] as const;
export type CommentTargetType = (typeof COMMENT_TARGET_TYPES)[number];

/** The polymorphic thread subject: a type tag + the id of that entity. */
export const CommentTargetSchema = z
  .object({
    type: z.enum(COMMENT_TARGET_TYPES),
    id: z.uuid(),
  })
  .strict();

export type CommentTarget = z.infer<typeof CommentTargetSchema>;
