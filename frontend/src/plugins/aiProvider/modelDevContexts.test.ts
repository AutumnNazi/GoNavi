import { describe, expect, it } from 'vitest';
import { contextForModelId, contextTiersFor, formatContextWindow, indexModelDevContexts, parseContextWindow } from './modelDevContexts';

const catalog = {
  alpha: { models: { 'deepseek-v4-pro': { id: 'deepseek-v4-pro', limit: { context: 1048576 } }, 'glm-5.3': { id: 'glm-5.3', limit: { context: 1000000 } } } },
  beta: { models: { 'deepseek-v4-pro@eu': { id: 'deepseek-v4-pro@eu', canonical_model_id: 'x/deepseek-v4-pro', limit: { context: 200000 } } } },
};

describe('modelDevContexts', () => {
  it('indexes the largest window across providers', () => {
    const index = indexModelDevContexts(catalog);
    expect(contextForModelId(index, 'deepseek-v4-pro')).toBe(1048576);
    expect(contextForModelId(index, 'x/glm-5.3')).toBe(1000000);
  });

  it('renders every window as a tier', () => {
    expect(formatContextWindow(1048576)).toBe('1M');
    expect(formatContextWindow(1000000)).toBe('1M');
    expect(formatContextWindow(1050000)).toBe('1M');
    expect(formatContextWindow(500000)).toBe('500K');
    expect(formatContextWindow(262144)).toBe('256K');
    expect(formatContextWindow(128000)).toBe('128K');
  });

  it('parses tier text and raw counts alike', () => {
    expect(parseContextWindow('1M')).toBe(1000000);
    expect(parseContextWindow('1.5m')).toBe(1500000);
    expect(parseContextWindow('500K')).toBe(500000);
    expect(parseContextWindow('128k')).toBe(128000);
    expect(parseContextWindow('1000000')).toBe(1000000);
    expect(parseContextWindow('1,000,000')).toBe(1000000);
    expect(parseContextWindow('0')).toBeNull();
    expect(parseContextWindow('abc')).toBeNull();
  });

  it('offers the selected models tiers, largest first, with defaults when unknown', () => {
    const index = indexModelDevContexts(catalog);
    expect(contextTiersFor(index, ['deepseek-v4-pro', 'glm-5.3'])).toEqual([1000000]);
    expect(contextTiersFor(index, ['unknown-model'])).toEqual([1000000, 500000, 256000, 200000, 128000]);
  });
});
