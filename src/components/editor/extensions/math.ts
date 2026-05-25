/**
 * Dynamic-import target for the math (KaTeX) editor extension. Splitting this
 * out lets `extensions.ts` reference only the schema-only `math-node.ts`,
 * keeping KaTeX + its CSS out of the initial editor bundle. Loaded on demand
 * by `extensions-lazy.ts#loadEditorExtension('math')`.
 */
export { MathBlock as default } from '../blocks/math';
