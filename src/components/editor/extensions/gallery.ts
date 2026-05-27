/**
 * Dynamic-import target for the Gallery editor extension. The bundled UI
 * lazy-loads the Lightbox modal inside the React node-view, so this shim
 * only carries the TipTap node + the lightweight view component.
 *
 * v0.9.0 G3 P16.
 */
export { Gallery as default } from '../blocks/gallery';
