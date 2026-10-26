import { describe, expect, it } from 'vitest';
import { validateAIProvider } from '../src/aiProviderDeclaration.js';
import { validateDataSource } from '../src/datasourceValidation.js';
import { validateExporter } from '../src/exporterDeclaration.js';
const exact = '中'.repeat(85);
const over = '中'.repeat(86);
const model = { id: 'model', name: 'Model', contextWindow: 4096, maxOutputTokens: 512 };
describe('declaration names use UTF-8 bytes', () => {
  it('accepts 255 bytes and rejects 258 bytes', () => {
    expect(() => validateDataSource({ id: 'fixture', name: exact, dialect: 'sqlite', readOnly: true })).not.toThrow();
    expect(() => validateDataSource({ id: 'fixture', name: over, dialect: 'sqlite', readOnly: true })).toThrow(/identity/);
    expect(() => validateExporter({ id: 'ndjson', name: exact, command: 'render', extension: 'ndjson', contentType: 'application/x-ndjson' })).not.toThrow();
    expect(() => validateExporter({ id: 'ndjson', name: over, command: 'render', extension: 'ndjson', contentType: 'application/x-ndjson' })).toThrow(/identity/);
    expect(() => validateAIProvider({ id: 'chat', name: exact, command: 'generate', supportsImages: false, models: [{ ...model, name: exact }] })).not.toThrow();
    expect(() => validateAIProvider({ id: 'chat', name: over, command: 'generate', supportsImages: false, models: [model] })).toThrow(/identity/);
    expect(() => validateAIProvider({ id: 'chat', name: 'Chat', command: 'generate', supportsImages: false, models: [{ ...model, name: over }] })).toThrow(/invalid ai model/);
  });
});
