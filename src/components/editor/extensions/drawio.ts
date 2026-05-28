/**
 * Dynamic-import target for the drawio editor extension. Drawio renders via
 * a viewer.diagrams.net iframe (no client-side renderer dependencies); this
 * shim only carries the TipTap node + the lightweight view component.
 */
export { Drawio as default } from '../blocks/drawio';
