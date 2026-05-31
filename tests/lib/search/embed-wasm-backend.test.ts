import { describe, expect, it } from 'vitest';
import { configureTransformersEnv } from '@/lib/search/embed';

/**
 * Shape mirrors the subset of @xenova/transformers' `env` we touch. The real
 * object has many more fields; configureTransformersEnv must only set ours and
 * leave the rest untouched.
 */
function makeEnv() {
  return {
    allowRemoteModels: true,
    allowLocalModels: false,
    localModelPath: '',
    backends: {
      onnx: {
        // onnxruntime-web exposes a `wasm` config block; onnxruntime-node does not.
        wasm: {
          numThreads: 4,
          proxy: true,
          wasmPaths: '',
        },
      },
    },
  };
}

describe('configureTransformersEnv', () => {
  it('forces local-only models pointed at the bundled set', () => {
    const env = makeEnv();
    configureTransformersEnv(env);
    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.localModelPath).toBe('/models/');
  });

  it('pins the onnx WASM backend single-threaded with no proxy', () => {
    const env = makeEnv();
    configureTransformersEnv(env);
    expect(env.backends.onnx.wasm.numThreads).toBe(1);
    expect(env.backends.onnx.wasm.proxy).toBe(false);
    expect(env.backends.onnx.wasm.wasmPaths).toBe('/onnx/');
  });

  it('is idempotent', () => {
    const env = makeEnv();
    configureTransformersEnv(env);
    configureTransformersEnv(env);
    expect(env.allowRemoteModels).toBe(false);
    expect(env.backends.onnx.wasm.numThreads).toBe(1);
  });

  it('tolerates a missing wasm sub-object (older shapes)', () => {
    const env = { backends: { onnx: {} } } as unknown as Parameters<
      typeof configureTransformersEnv
    >[0];
    expect(() => configureTransformersEnv(env)).not.toThrow();
  });
});
