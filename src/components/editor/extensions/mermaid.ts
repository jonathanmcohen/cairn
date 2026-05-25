/**
 * Dynamic-import target for the Mermaid editor extension. The bundled UI
 * lazy-loads the `mermaid` npm package inside the React node-view, so this
 * shim only carries the TipTap node + the lightweight view component.
 */
export { Mermaid as default } from '../blocks/mermaid';
