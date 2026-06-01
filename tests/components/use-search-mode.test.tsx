// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEARCH_MODES, useSearchMode } from '@/lib/search/use-search-mode';

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('useSearchMode (#164)', () => {
  it('exposes the three backend modes in order', () => {
    expect(SEARCH_MODES).toEqual(['fts', 'semantic', 'hybrid']);
  });

  it('defaults to fts', () => {
    const { result } = renderHook(() => useSearchMode());
    expect(result.current.mode).toBe('fts');
  });

  it('persists the chosen mode across remounts', () => {
    const first = renderHook(() => useSearchMode());
    act(() => first.result.current.setMode('hybrid'));
    expect(first.result.current.mode).toBe('hybrid');
    const second = renderHook(() => useSearchMode());
    expect(second.result.current.mode).toBe('hybrid');
  });

  it('ignores a corrupt stored value and falls back to fts', () => {
    window.localStorage.setItem('cairn:search-mode', 'garbage');
    const { result } = renderHook(() => useSearchMode());
    expect(result.current.mode).toBe('fts');
  });
});
