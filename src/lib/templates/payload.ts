import { z } from 'zod';

/**
 * A portable, workspace-free snapshot. Entity ids in here are the *source*
 * ids captured from the origin workspace; they are placeholders that
 * `rewriteRefs` remaps to fresh uuids on instantiation. The payload never
 * stores `workspaceId`, `createdBy`, or timestamps — those are assigned on
 * instantiate.
 */
export const TemplatePageSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  icon: z.string().nullable(),
  content: z.unknown(), // ProseMirror/TipTap doc JSON
});

export const TemplatePropertySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(), // PropertyType, kept loose so future relation/rollup parse
  config: z.unknown().default({}),
  position: z.number().int(),
});

export const TemplateViewSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  config: z.unknown().default({}),
  position: z.number().int(),
});

export const TemplateRowSchema = z.object({
  id: z.string(),
  cells: z.array(z.object({ propertyId: z.string(), value: z.unknown() })),
});

export const TemplateDatabaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  properties: z.array(TemplatePropertySchema),
  views: z.array(TemplateViewSchema),
  rows: z.array(TemplateRowSchema).default([]),
});

export const TemplatePayloadSchema = z.object({
  kind: z.enum(['page', 'database']),
  rootPageId: z.string().optional(),
  rootDatabaseId: z.string().optional(),
  pages: z.array(TemplatePageSchema).default([]),
  databases: z.array(TemplateDatabaseSchema).default([]),
});

export type TemplatePayload = z.infer<typeof TemplatePayloadSchema>;
export type TemplatePage = z.infer<typeof TemplatePageSchema>;
export type TemplateDatabase = z.infer<typeof TemplateDatabaseSchema>;
export type TemplateProperty = z.infer<typeof TemplatePropertySchema>;
export type TemplateView = z.infer<typeof TemplateViewSchema>;
export type TemplateRow = z.infer<typeof TemplateRowSchema>;
