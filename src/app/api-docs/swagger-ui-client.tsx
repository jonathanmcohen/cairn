'use client';

/**
 * Client-only Swagger UI host. We import `swagger-ui-dist` dynamically so the
 * heavy bundle is excluded from the initial RSC payload and only loaded on the
 * /api-docs route. CSS is imported eagerly — Next.js will scope and inline it.
 *
 * No CDN — the bundle is shipped with the app, so CSP `script-src 'self'`
 * suffices. The page-level CSS for Swagger UI lives in swagger-ui-dist.
 */
import 'swagger-ui-dist/swagger-ui.css';
import './swagger-dark.css';
import { useEffect, useRef } from 'react';

type SwaggerLike = (opts: {
  url: string;
  domNode: HTMLElement;
  deepLinking: boolean;
  docExpansion: 'list' | 'full' | 'none';
}) => unknown;

export default function SwaggerUiClient({ specUrl }: { specUrl: string }) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Dynamic import — keeps the ~2MB bundle off the critical path.
      const mod = (await import('swagger-ui-dist/swagger-ui-es-bundle.js')) as unknown as
        | { default: SwaggerLike }
        | SwaggerLike;
      const SwaggerUIBundle: SwaggerLike =
        typeof (mod as { default?: SwaggerLike }).default === 'function'
          ? (mod as { default: SwaggerLike }).default
          : (mod as SwaggerLike);
      if (cancelled || !ref.current) return;
      SwaggerUIBundle({
        url: specUrl,
        domNode: ref.current,
        deepLinking: true,
        docExpansion: 'list',
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [specUrl]);

  return <section ref={ref} aria-label="Swagger UI" />;
}
