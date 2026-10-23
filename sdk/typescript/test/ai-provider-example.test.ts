import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAIProvider } from '../src/aiProviderDeclaration.js';
import type { Manifest } from '../src/types.js';
describe('shipped ai provider example', () => {
  it('stays a text provider without images', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../examples/plugins/ai-provider/gonavi.plugin.json', import.meta.url), 'utf8')) as Manifest;
    const provider = manifest.contributes?.aiProviders?.[0];
    expect(provider?.supportsImages).toBe(false);
    expect(() => validateAIProvider(provider ?? { id: '', name: '', command: '', supportsImages: true, models: [] })).not.toThrow();
  });
});
