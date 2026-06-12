// scripts/fetch-embedding-assets.mjs
// v0.9.6 G4 (#136): stage the local-embedding assets into public/ so the
// WASM backend (configured in src/lib/search/embed.ts) can load them
// same-origin at runtime — no HF Hub fetch, no CSP violation.
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const EMBEDDING_ASSETS = {
  // Where the WASM backend expects them (localModelPath='/models/', wasmPaths='/onnx/').
  modelDir: 'public/models/Xenova/all-MiniLM-L6-v2',
  wasmDir: 'public/onnx',
  // HF repo + pinned revision for the MiniLM feature-extraction model.
  repo: 'Xenova/all-MiniLM-L6-v2',
  revision: 'main',
  modelFiles: [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx',
  ],
  // Copied from onnxruntime-web/dist. The quantized single-thread build only
  // needs the non-threaded, non-SIMD-proxy binary; we copy the whole set.
  wasmFiles: ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd.wasm', 'ort-wasm.wasm'],
};

const HF_BASE = 'https://huggingface.co';

async function download(url, dest, attempts = 3) {
  mkdirSync(dirname(dest), { recursive: true });
  // The HuggingFace CDN intermittently times out from CI runners
  // (ConnectTimeoutError, ~10s) — retry with backoff before failing the build.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) {
        throw new Error(`fetch-embedding-assets: ${res.status} ${res.statusText} for ${url}`);
      }
      await pipeline(res.body, createWriteStream(dest));
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      const delaySeconds = attempt * 5;
      console.warn(
        `[embed-assets] attempt ${attempt}/${attempts} failed for ${url} (${err?.cause ?? err?.message}); retrying in ${delaySeconds}s`,
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delaySeconds * 1000));
    }
  }
}

async function stageModel() {
  const outDir = join(root, EMBEDDING_ASSETS.modelDir);
  const sentinel = join(outDir, 'onnx', 'model_quantized.onnx');
  if (existsSync(sentinel)) {
    // biome-ignore lint/suspicious/noConsole: build-time script status output
    console.log('[embed-assets] model already staged, skipping');
    return;
  }
  for (const file of EMBEDDING_ASSETS.modelFiles) {
    const url = `${HF_BASE}/${EMBEDDING_ASSETS.repo}/resolve/${EMBEDDING_ASSETS.revision}/${file}`;
    const dest = join(outDir, file);
    // biome-ignore lint/suspicious/noConsole: build-time script status output
    console.log(`[embed-assets] downloading ${file}`);
    await download(url, dest);
  }
}

/**
 * onnxruntime-web is a (nested) dependency of @xenova/transformers. Under pnpm
 * it is NOT hoisted to the top-level node_modules, so resolve its `dist` dir
 * from a few candidate layouts instead of assuming a flat layout.
 */
function resolveOrtWebDist() {
  const candidates = [
    // npm/yarn flat layout (or pnpm hoisted).
    join(root, 'node_modules', 'onnxruntime-web', 'dist'),
    // pnpm: dependency of @xenova/transformers, kept nested.
    join(
      root,
      'node_modules',
      '@xenova',
      'transformers',
      'node_modules',
      'onnxruntime-web',
      'dist',
    ),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  // pnpm's content-addressed store: node_modules/.pnpm/onnxruntime-web@<ver>/...
  const pnpmDir = join(root, 'node_modules', '.pnpm');
  if (existsSync(pnpmDir)) {
    const match = readdirSync(pnpmDir).find((e) => e.startsWith('onnxruntime-web@'));
    if (match) {
      const dir = join(pnpmDir, match, 'node_modules', 'onnxruntime-web', 'dist');
      if (existsSync(dir)) return dir;
    }
  }
  return null;
}

function stageWasm() {
  const srcDir = resolveOrtWebDist();
  const outDir = join(root, EMBEDDING_ASSETS.wasmDir);
  if (!srcDir || !existsSync(srcDir)) {
    throw new Error(
      '[embed-assets] onnxruntime-web/dist not found — run pnpm install (it ships under @xenova/transformers)',
    );
  }
  mkdirSync(outDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if (entry.endsWith('.wasm') || entry.endsWith('.mjs')) {
      cpSync(join(srcDir, entry), join(outDir, entry));
    }
  }
  // biome-ignore lint/suspicious/noConsole: build-time script status output
  console.log(`[embed-assets] staged wasm binaries into ${EMBEDDING_ASSETS.wasmDir}`);
}

// Only run side effects when invoked directly, not when imported by tests.
const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await stageModel();
  stageWasm();
  // biome-ignore lint/suspicious/noConsole: build-time script status output
  console.log('[embed-assets] done');
}
