/**
 * /api-docs — Swagger UI host for the Cairn public v1 API.
 *
 * RSC: server-side auth gate, then renders the client-only Swagger UI shell.
 * Workspace-member gated (any role suffices). Unauthenticated → /signin.
 */
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/require-role';
import { ApiDocsHeader } from './api-docs-header';
import SwaggerUiClient from './swagger-ui-client';

export default async function ApiDocsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/signin?callbackUrl=/api-docs');
  if (!ctx.workspaceId) redirect('/');

  return (
    <main aria-label="API documentation" className="min-h-screen bg-background">
      <ApiDocsHeader />
      <div className="p-4">
        <SwaggerUiClient specUrl="/openapi.json" />
      </div>
    </main>
  );
}
