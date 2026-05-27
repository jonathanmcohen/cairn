// Ambient declaration for the worker URL import used by the PDF viewer
// (v0.9.0 G3 P17). Next.js / Turbopack resolves the `?url` suffix to a static
// asset URL at build time; the runtime value is a string. TypeScript needs an
// explicit module declaration so `import x from '...?url'` typechecks.
declare module '*?url' {
  const url: string;
  export default url;
}
