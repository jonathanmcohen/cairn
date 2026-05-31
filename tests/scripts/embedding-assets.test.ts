import { describe, expect, it } from 'vitest';
// The build-time staging script is a plain .mjs with no .d.ts; tsconfig has
// allowJs:false so TS can't synthesize types for it. We only read the static
// EMBEDDING_ASSETS manifest here, so import it untyped and assert its shape.
// @ts-expect-error -- untyped .mjs module (allowJs:false), shape asserted below
import { EMBEDDING_ASSETS } from '../../scripts/fetch-embedding-assets.mjs';

describe('embedding asset manifest (#136)', () => {
  it('declares the MiniLM model dir under public/models', () => {
    expect(EMBEDDING_ASSETS.modelDir).toBe('public/models/Xenova/all-MiniLM-L6-v2');
  });

  it('declares the onnxruntime-web wasm dir under public/onnx', () => {
    expect(EMBEDDING_ASSETS.wasmDir).toBe('public/onnx');
  });

  it('lists the quantized onnx model + tokenizer files', () => {
    expect(EMBEDDING_ASSETS.modelFiles).toContain('onnx/model_quantized.onnx');
    expect(EMBEDDING_ASSETS.modelFiles).toContain('tokenizer.json');
    expect(EMBEDDING_ASSETS.modelFiles).toContain('config.json');
  });

  it('lists at least the core ort-wasm binary', () => {
    expect(EMBEDDING_ASSETS.wasmFiles.some((f: string) => f.endsWith('.wasm'))).toBe(true);
  });
});
