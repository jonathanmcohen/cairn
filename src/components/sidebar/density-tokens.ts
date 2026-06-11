/**
 * v0.10.0 H3 — sidebar density tokens in a dependency-free module so the
 * runtime-px e2e guard (tests/e2e/item-H3-sidebar-density-px.spec.ts) can
 * import the CONTRACT directly: the component module pulls next/link and
 * cannot be loaded in the Playwright node context. A deliberate density
 * change edits this one constant; the component, the unit guard and the
 * pixel-measurement e2e all follow.
 */
export const ROW_HEIGHT_PX = 26; // Compact dense row (#208).
export const DEPTH_INDENT_PX = 16; // 16px per level; matches the v0.7 visual.
