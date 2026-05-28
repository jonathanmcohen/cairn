import SwaggerParser from '@apidevtools/swagger-parser';
import { describe, expect, it } from 'vitest';
import { generateOpenApiDocument } from '@/lib/openapi/generate';

describe('generateOpenApiDocument', () => {
  it('produces an OpenAPI 3.1 document that lints clean', async () => {
    const doc = generateOpenApiDocument();
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.info.title).toBe('Cairn API');
    expect(doc.info.version).toBeTruthy();
    // SwaggerParser.validate throws on any structural defect.
    // Pass via JSON round-trip — strips Zod prototype noise + unfreezes nested
    // refs so the validator can walk them.
    const plain = JSON.parse(JSON.stringify(doc));
    await SwaggerParser.validate(plain);
  });

  it('round-trips POST /api/v1/pages: request body + 201 response present', () => {
    const doc = generateOpenApiDocument();
    // biome-ignore lint/suspicious/noExplicitAny: spec is dynamic-shape
    const op = (doc as any).paths?.['/api/v1/pages']?.post;
    expect(op).toBeDefined();
    expect(op?.requestBody).toBeDefined();
    expect(op?.responses?.['201']).toBeDefined();
  });

  it('round-trips GET /api/v1/pages/{pageId}: path param + 200 response', () => {
    const doc = generateOpenApiDocument();
    // biome-ignore lint/suspicious/noExplicitAny: spec is dynamic-shape
    const op = (doc as any).paths?.['/api/v1/pages/{pageId}']?.get;
    expect(op).toBeDefined();
    // path params surface as `parameters: [{in: 'path', name: 'pageId', ...}]`
    expect(op?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ in: 'path', name: 'pageId' })]),
    );
    expect(op?.responses?.['200']).toBeDefined();
  });

  it('declares both session + bearer (PAT) security schemes', () => {
    const doc = generateOpenApiDocument();
    expect(doc.components?.securitySchemes?.session).toBeDefined();
    expect(doc.components?.securitySchemes?.pat).toBeDefined();
  });

  it('tags routes by domain', () => {
    const doc = generateOpenApiDocument();
    const tagNames = (doc.tags ?? []).map((t) => t.name);
    expect(tagNames).toEqual(expect.arrayContaining(['Pages', 'Databases']));
  });

  it('every manifest route appears in paths', () => {
    const doc = generateOpenApiDocument();
    // biome-ignore lint/suspicious/noExplicitAny: spec is dynamic-shape
    const paths = Object.keys((doc as any).paths ?? {});
    // We have 6 distinct path templates across the v1 surface.
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/pages',
        '/api/v1/pages/{pageId}',
        '/api/v1/databases',
        '/api/v1/databases/{databaseId}',
        '/api/v1/databases/{databaseId}/rows',
        '/api/v1/databases/{databaseId}/rows/{rowId}',
      ]),
    );
  });
});
