/**
 * EmbeddingProvider — the single interface every embedding consumer (the
 * on-write hook in P12, the reindex CLI in P12, the semantic-search route
 * in P13) talks to.
 *
 * Two implementations:
 * - LocalEmbeddingProvider:  Xenova/all-MiniLM-L6-v2 (MIT, 384-dim, ~80MB on
 *   disk) loaded via @xenova/transformers' feature-extraction pipeline.
 *   Used by default — keeps Cairn self-contained for the homelab case.
 * - RemoteEmbeddingProvider: POSTs to an OpenAI-compatible /embeddings
 *   endpoint. Used when CAIRN_EMBEDDING_URL is set. Compatible with
 *   Ollama / OpenAI / Together / vLLM.
 *
 * The factory `getEmbeddingProvider()` is the only export module callers
 * should reach for. It caches one provider per process — embedding models
 * are heavy to load, and the local one occupies ORT session state we want
 * to amortize across requests.
 */

export const EMBEDDING_DIM = 384 as const;

export interface EmbeddingProvider {
  /** Discriminator for logging + the embedding_generation_total{provider} metric (P9). */
  readonly kind: 'local' | 'remote';
  /** Always 384 for both providers (MiniLM-L6 dimension). */
  readonly dim: number;
  /** Model identifier; surfaced in telemetry only — not a behavioral key. */
  readonly model: string;
  /** Embed one text into a 384-dim Float32Array (cosine-comparable). */
  embed(text: string): Promise<Float32Array>;
}

/**
 * Minimal structural view of the @xenova/transformers `env` singleton — only
 * the fields we set. Kept local (not imported) so this module stays free of a
 * static dependency on the heavy library.
 */
export interface TransformersEnv {
  allowRemoteModels?: boolean;
  allowLocalModels?: boolean;
  localModelPath?: string;
  backends?: {
    onnx?: {
      wasm?: {
        numThreads?: number;
        proxy?: boolean;
        wasmPaths?: string;
      };
    };
  };
}

/**
 * v0.9.6 G4 (#136) — force Transformers.js onto the pure-WASM onnxruntime-web
 * backend so the runtime image needs no native onnxruntime-node `.so`.
 *
 * - allowRemoteModels=false + allowLocalModels=true + localModelPath='/models/'
 *   makes the loader read the bundled MiniLM set under `public/models` instead
 *   of fetching from the HF Hub (which is blocked by CSP and absent offline).
 * - numThreads=1 + proxy=false keeps ORT on the single-threaded WASM path: no
 *   SharedArrayBuffer / cross-origin-isolation requirement, no Worker, which is
 *   what makes this portable across base images and arm64/amd64.
 * - wasmPaths='/onnx/' points ORT at the self-hosted `.wasm` binaries under
 *   `public/onnx` so it never hits a CDN (CSP `connect-src` would reject it).
 *
 * Pure + idempotent: it only mutates the passed env. Tested without importing
 * the real library.
 */
export function configureTransformersEnv(env: TransformersEnv): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = '/models/';
  if (!env.backends) env.backends = {};
  if (!env.backends.onnx) env.backends.onnx = {};
  if (!env.backends.onnx.wasm) env.backends.onnx.wasm = {};
  const wasm = env.backends.onnx.wasm;
  wasm.numThreads = 1;
  wasm.proxy = false;
  wasm.wasmPaths = '/onnx/';
}

// --- Local provider -------------------------------------------------------

class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'local' as const;
  readonly dim = EMBEDDING_DIM;
  readonly model = 'Xenova/all-MiniLM-L6-v2';
  // The Xenova pipeline is lazy-loaded on first embed() call so the cold
  // start doesn't fire on module import (matters for the Next.js dev server
  // and the entrypoint build).
  private pipelinePromise: Promise<unknown> | null = null;

  private async getPipeline(): Promise<unknown> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        // Lazy + dynamic import — keeps the heavy ORT bindings out of the
        // import graph until the first embed actually runs.
        const transformers = await import('@xenova/transformers');
        // v0.9.6 G4 (#136): pin the WASM backend + bundled models BEFORE the
        // first pipeline() call. The env singleton is read at model-load time.
        configureTransformersEnv(transformers.env as unknown as TransformersEnv);
        const { pipeline } = transformers;
        // feature-extraction returns the mean-pooled + normalized sentence
        // embedding when called with pooling:'mean', normalize:true (set in
        // the call site below).
        return pipeline('feature-extraction', this.model);
      })();
    }
    return this.pipelinePromise;
  }

  async embed(text: string): Promise<Float32Array> {
    const extractor = (await this.getPipeline()) as (
      input: string,
      opts: { pooling: 'mean'; normalize: boolean },
    ) => Promise<{ data: Float32Array | number[]; dims: number[] }>;
    // Empty string is allowed — the model produces a stable zero-ish vector
    // for it; callers in P12 short-circuit before reaching here for empty
    // pages.
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    const data = out.data instanceof Float32Array ? out.data : new Float32Array(out.data);
    if (data.length !== EMBEDDING_DIM) {
      throw new Error(
        `LocalEmbeddingProvider: expected ${EMBEDDING_DIM}-dim output, got ${data.length}`,
      );
    }
    return data;
  }
}

// --- Remote provider ------------------------------------------------------

class RemoteEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'remote' as const;
  readonly dim = EMBEDDING_DIM;
  readonly model: string;
  private readonly url: string;
  private readonly apiKey: string | undefined;

  constructor(args: { url: string; model: string; apiKey?: string }) {
    this.url = args.url;
    this.model = args.model;
    this.apiKey = args.apiKey;
  }

  async embed(text: string): Promise<Float32Array> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `RemoteEmbeddingProvider: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as { data?: { embedding?: number[] }[] };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec)) {
      throw new Error('RemoteEmbeddingProvider: malformed response (no data[0].embedding)');
    }
    if (vec.length !== EMBEDDING_DIM) {
      throw new Error(
        `RemoteEmbeddingProvider: dimension mismatch — expected ${EMBEDDING_DIM}, got ${vec.length}`,
      );
    }
    return new Float32Array(vec);
  }
}

// --- Factory --------------------------------------------------------------

let singleton: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (singleton) return singleton;
  const url = process.env.CAIRN_EMBEDDING_URL?.trim();
  if (url) {
    const model = process.env.CAIRN_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
    const apiKey = process.env.CAIRN_EMBEDDING_API_KEY?.trim() || undefined;
    singleton = new RemoteEmbeddingProvider({ url, model, apiKey });
  } else {
    singleton = new LocalEmbeddingProvider();
  }
  return singleton;
}

/** Test-only seam: drop the cached singleton so a new call re-reads env. */
export function __resetEmbeddingProviderForTests(): void {
  singleton = null;
}
