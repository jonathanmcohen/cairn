/**
 * Dynamic-import target for the synced-block editor extension. Carries a full
 * DOMSerializer instance + React node-view; kept out of the static extensions
 * list and loaded on demand.
 */
export { SyncedBlock as default } from '../blocks/synced-block';
