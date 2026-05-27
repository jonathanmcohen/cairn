/**
 * /api-docs — Swagger UI host for the Cairn public v1 API.
 *
 * RSC: server-side auth gate, then renders the client-only Swagger UI shell.
 * Workspace-member gated (any role suffices). Unauthenticated → /signin.
 */
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/require-role';
import SwaggerUiClient from './swagger-ui-client';

export default async function ApiDocsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/signin?callbackUrl=/api-docs');
  if (!ctx.workspaceId) redirect('/');

  return (
    <main aria-label="API documentation" className="min-h-screen bg-background p-4">
      <h1 className="sr-only">Cairn API documentation</h1>
      <SwaggerUiClient specUrl="/openapi.json" />
    </main>
  );
}
