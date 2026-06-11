// Hand-written declarations for generate-release-notes.mjs (tsconfig has
// allowJs:false; the drift-guard vitest imports the parse logic directly).
export declare function extractSection(changelog: string, version: string): string | null;
export declare function renderModule(version: string, markdown: string | null): string;
export declare function generate(repoRoot: string): {
  version: string;
  markdown: string | null;
  source: string;
};
