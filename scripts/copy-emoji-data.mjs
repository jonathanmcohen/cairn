// Copy the emojibase emoji dataset into public/ so the emoji picker fetches it
// same-origin. Cairn's CSP is strict (`connect-src 'self'` + collab WS only),
// which blocks emoji-picker-element's default jsdelivr CDN data fetch — so the
// data must be served by the app itself. Generated file (gitignored), mirroring
// how public/sw.js is produced. Runs in `dev` + `build` (incl. the Docker build).

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const src = require.resolve('emoji-picker-element-data/en/emojibase/data.json');
const root = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const destDir = join(root, 'public');
const dest = join(destDir, 'emoji-data.json');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);

// Guard: a truncated / wrong dataset would render an empty emoji grid (#130).
// Fail the build rather than ship a picker that silently shows nothing.
const parsed = JSON.parse(readFileSync(dest, 'utf8'));
if (!Array.isArray(parsed) || parsed.length < 1000) {
  throw new Error(
    `[copy-emoji-data] dataset at ${dest} looks wrong (` +
      `${Array.isArray(parsed) ? `${parsed.length} entries` : typeof parsed}` +
      `) — emoji grid would be empty`,
  );
}

// biome-ignore lint/suspicious/noConsole: build-time script status output
console.log(`[copy-emoji-data] ${src} -> ${dest} (${parsed.length} emoji)`);
