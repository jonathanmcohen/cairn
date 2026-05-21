import { z } from 'zod';

/** A comment anchored to a stable block id (the supported anchored-highlight path). */
export const BlockAnchorSchema = z.object({ blockId: z.string().min(1) }).strict();

/** A comment anchored to a ProseMirror position range (stored; range-highlight is a v0.3.x refinement). */
export const RangeAnchorSchema = z
  .object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() })
  .strict()
  .refine((a) => a.to >= a.from, { message: 'to must be >= from' });

/** Non-null anchor: exactly one of the two shapes. */
export const CommentAnchorSchema = z.union([BlockAnchorSchema, RangeAnchorSchema]);

export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;
