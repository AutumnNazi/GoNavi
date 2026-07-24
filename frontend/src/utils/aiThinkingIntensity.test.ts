import { describe, expect, it } from 'vitest';

import {
  coerceThinkingIntensityForProfile,
  resolveThinkingIntensityOptions,
  resolveThinkingIntensityProfile,
} from './aiThinkingIntensity';

describe('aiThinkingIntensity', () => {
  it('detects OpenAI profile for gpt providers', () => {
    expect(resolveThinkingIntensityProfile({
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.2',
    })).toBe('openai');
  });

  it('detects OpenAI profile for the Responses API format', () => {
    expect(resolveThinkingIntensityProfile({
      type: 'custom',
      apiFormat: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
    })).toBe('openai');
  });

  it('detects DeepSeek even when api format is anthropic', () => {
    expect(resolveThinkingIntensityProfile({
      type: 'custom',
      apiFormat: 'anthropic',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    })).toBe('deepseek');
  });

  it('exposes openai-style levels including xhigh', () => {
    const values = resolveThinkingIntensityOptions('openai').map((item) => item.value);
    expect(values).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  });

  it('exposes anthropic-style levels including max', () => {
    const values = resolveThinkingIntensityOptions('anthropic').map((item) => item.value);
    expect(values).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('coerces openai none when switching away from deepseek off', () => {
    expect(coerceThinkingIntensityForProfile('off', 'openai')).toBe('none');
    expect(coerceThinkingIntensityForProfile('xhigh', 'deepseek')).toBe('high');
    expect(coerceThinkingIntensityForProfile('max', 'openai')).toBe('xhigh');
  });
});
