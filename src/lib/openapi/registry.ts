/**
 * Builds an `OpenAPIRegistry` from the central route manifest. Each path is
 * registered with its request/query schemas and a primary success response;
 * unauthenticated/forbidden/not-found are added as common error shapes.
 */
import { OpenAPIRegistry, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from './decorators';
import { type ManifestEntry, manifest } from './manifest';

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
}

function componentName(entry: ManifestEntry, suffix: string): string {
  return `${sanitize(entry.method)}__${sanitize(entry.path)}__${suffix}`;
}

function buildPathParamsSchema(entry: ManifestEntry): z.ZodObject | undefined {
  if (!entry.pathParams || entry.pathParams.length === 0) return undefined;
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of entry.pathParams) {
    shape[p] = z
      .string()
      .openapi({ description: `${p} (UUID)`, example: '00000000-0000-0000-0000-000000000000' });
  }
  return z.object(shape);
}

export function buildRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: 'next-auth.session-token',
  });
  registry.registerComponent('securitySchemes', 'pat', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'PAT',
  });

  for (const entry of manifest) {
    const request: RouteConfig['request'] = {};

    const paramsSchema = buildPathParamsSchema(entry);
    if (paramsSchema) request.params = paramsSchema;

    if (entry.querySchema) {
      request.query = registry.register(
        componentName(entry, 'Query'),
        entry.querySchema,
      ) as z.ZodObject;
    }

    if (entry.requestSchema) {
      request.body = {
        content: {
          'application/json': {
            schema: registry.register(componentName(entry, 'Request'), entry.requestSchema),
          },
        },
      };
    }

    const responses: RouteConfig['responses'] = {
      [String(entry.successStatus ?? 200)]: {
        description: 'Success',
        ...(entry.responseSchema
          ? {
              content: {
                'application/json': {
                  schema: registry.register(componentName(entry, 'Response'), entry.responseSchema),
                },
              },
            }
          : {}),
      },
      '401': { description: 'Unauthorized' },
      '403': { description: 'Forbidden' },
      '404': { description: 'Not Found' },
    };

    registry.registerPath({
      method: entry.method.toLowerCase() as Lowercase<ManifestEntry['method']>,
      path: entry.path,
      summary: entry.summary,
      tags: entry.tags,
      security: (entry.security ?? ['pat']).map((s) => ({ [s]: [] })),
      request,
      responses,
    });
  }

  return registry;
}
