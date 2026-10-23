import { describe, expect, it } from 'vitest';
import { validateAIProvider } from '../src/aiProviderDeclaration.js';
import type { AIProvider, Manifest } from '../src/types.js';

describe('AI provider metadata', () => {
  it('preserves explicit capability flags and a static model catalog', () => {
    const provider: AIProvider = { id: 'demo', name: 'Demo', command: 'generate', models: [{ id: 'model/A:1', name: 'Model', contextWindow: 4096, maxOutputTokens: 512 }], supportsTools: false, supportsImages: false };
    const manifest: Manifest = { schemaVersion: 1, apiVersion: 1, id: 'example.ai', name: 'Example', version: '1.0.0', permissions: ['ai.providers'], contributes: { aiProviders: [provider] } };
    expect(JSON.parse(JSON.stringify(manifest)).contributes.aiProviders).toEqual([provider]);
    expect(JSON.stringify(provider)).toContain('"supportsImages":false');
  });
  it('counts provider and model names in UTF-8 bytes and rejects images', () => {
    const model = { id: 'model-a', name: '界'.repeat(85), contextWindow: 4096, maxOutputTokens: 512 };
    expect(() => validateAIProvider({ id: 'demo', name: '中'.repeat(85), command: 'generate', supportsImages: false, models: [model] })).not.toThrow();
    expect(() => validateAIProvider({ id: 'demo', name: '中'.repeat(86), command: 'generate', supportsImages: false, models: [model] })).toThrow(/identity/);
    expect(() => validateAIProvider({ id: 'demo', name: 'Demo', command: 'generate', supportsImages: false, models: [{ ...model, name: '界'.repeat(86) }] })).toThrow(/model/);
    expect(() => validateAIProvider({ id: 'demo', name: 'Demo', command: 'generate', supportsImages: true, models: [model] })).toThrow(/images/);
  });
});
