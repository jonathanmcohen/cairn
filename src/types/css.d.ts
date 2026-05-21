// Ambient declarations for CSS side-effect imports.
// Next.js resolves these at build time; TypeScript 6 (TS2882) requires a
// declaration for side-effect imports of non-code modules.
declare module '*.css';
