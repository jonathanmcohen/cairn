/**
 * Dynamic-import target for the PlantUML editor extension. The bundled UI
 * lazy-loads the `plantuml-encoder` npm package inside the React node-view,
 * so this shim only carries the TipTap node + the lightweight view component.
 */
export { PlantUml as default } from '../blocks/plantuml';
