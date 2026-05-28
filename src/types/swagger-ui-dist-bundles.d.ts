// Ambient declarations for the un-typed swagger-ui-dist bundle entrypoints.
// `@types/swagger-ui-dist` only types the package root; the individual bundle
// files we import dynamically (to keep the bundle off the critical path) are
// raw JS. v0.9.0 G7 P38.
declare module 'swagger-ui-dist/swagger-ui-es-bundle.js' {
  type Configs = {
    url: string;
    domNode: HTMLElement;
    deepLinking?: boolean;
    docExpansion?: 'list' | 'full' | 'none';
    [k: string]: unknown;
  };
  const SwaggerUIBundle: (cfg: Configs) => unknown;
  export default SwaggerUIBundle;
}

declare module 'swagger-ui-dist/swagger-ui-es-bundle-core.js' {
  type Configs = {
    url: string;
    domNode: HTMLElement;
    deepLinking?: boolean;
    docExpansion?: 'list' | 'full' | 'none';
    [k: string]: unknown;
  };
  const SwaggerUIBundle: (cfg: Configs) => unknown;
  export default SwaggerUIBundle;
}
