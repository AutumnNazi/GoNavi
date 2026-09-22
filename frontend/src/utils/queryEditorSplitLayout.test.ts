import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUERY_EDITOR_EDITOR_HEIGHT_RATIO,
  MAX_QUERY_EDITOR_EDITOR_HEIGHT_RATIO,
  MIN_QUERY_EDITOR_EDITOR_HEIGHT,
  MIN_QUERY_EDITOR_EDITOR_HEIGHT_RATIO,
  MIN_QUERY_EDITOR_RESULT_HEIGHT,
  clampQueryEditorEditorHeight,
  resetQueryEditorTabSplitRatiosForTests,
  resolveQueryEditorEditorHeightFromRatio,
  resolveQueryEditorEditorHeightRatio,
  resolveQueryEditorTabSplitRatio,
  sanitizeQueryEditorEditorHeightRatio,
  setQueryEditorTabSplitRatio,
} from './queryEditorSplitLayout';

describe('query editor split layout', () => {
  it('sanitizes persisted editor height ratios', () => {
    expect(sanitizeQueryEditorEditorHeightRatio(undefined)).toBe(DEFAULT_QUERY_EDITOR_EDITOR_HEIGHT_RATIO);
    expect(sanitizeQueryEditorEditorHeightRatio(Number.NaN)).toBe(DEFAULT_QUERY_EDITOR_EDITOR_HEIGHT_RATIO);
    expect(sanitizeQueryEditorEditorHeightRatio(0.01)).toBe(MIN_QUERY_EDITOR_EDITOR_HEIGHT_RATIO);
    expect(sanitizeQueryEditorEditorHeightRatio(0.99)).toBe(MAX_QUERY_EDITOR_EDITOR_HEIGHT_RATIO);
    expect(sanitizeQueryEditorEditorHeightRatio(0.62)).toBe(0.62);
  });

  it('resolves editor height from a persisted ratio while leaving room for results', () => {
    expect(resolveQueryEditorEditorHeightFromRatio(0.5, 800)).toBe(400);
    expect(resolveQueryEditorEditorHeightFromRatio(0.9, 800)).toBe(680);
    expect(resolveQueryEditorEditorHeightFromRatio(0.01, 800)).toBe(144);
    expect(resolveQueryEditorEditorHeightFromRatio(0.5, 0)).toBe(MIN_QUERY_EDITOR_EDITOR_HEIGHT);
  });

  it('clamps editor height to valid split bounds', () => {
    expect(clampQueryEditorEditorHeight(20, 800)).toBe(MIN_QUERY_EDITOR_EDITOR_HEIGHT);
    expect(clampQueryEditorEditorHeight(760, 800)).toBe(800 - MIN_QUERY_EDITOR_RESULT_HEIGHT);
    expect(clampQueryEditorEditorHeight(360, 800)).toBe(360);
  });

  it('resolves persisted ratio from the final editor height', () => {
    expect(resolveQueryEditorEditorHeightRatio(480, 800)).toBe(0.6);
    expect(resolveQueryEditorEditorHeightRatio(20, 800)).toBe(MIN_QUERY_EDITOR_EDITOR_HEIGHT_RATIO);
    expect(resolveQueryEditorEditorHeightRatio(760, 800)).toBe(MAX_QUERY_EDITOR_EDITOR_HEIGHT_RATIO);
    expect(resolveQueryEditorEditorHeightRatio(480, 0)).toBe(DEFAULT_QUERY_EDITOR_EDITOR_HEIGHT_RATIO);
  });

  it('keeps each query tab split ratio independent', () => {
    resetQueryEditorTabSplitRatiosForTests();
    setQueryEditorTabSplitRatio('tab-1', 0.75);
    expect(resolveQueryEditorTabSplitRatio('tab-1', 0.5)).toBe(0.75);
    expect(resolveQueryEditorTabSplitRatio('tab-2', 0.5)).toBe(0.5);
    resetQueryEditorTabSplitRatiosForTests();
  });
});
