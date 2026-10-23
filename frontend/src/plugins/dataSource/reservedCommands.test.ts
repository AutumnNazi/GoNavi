import { describe, expect, it } from 'vitest';
import { publicPluginCommands } from './reservedCommands';
import { validateUINode } from '../uiValidation';
import type { PluginManifest } from '../types';
const manifest: PluginManifest = { schemaVersion: 1, apiVersion: 1, id: 'demo.source', name: 'Demo', version: '1', permissions: ['data.sources'],
  contributes: { commands: [{ id: 'adapter', title: 'Adapter' }, { id: 'hello', title: 'Hello' }], dataSources: [{ id: 'reader', name: 'Reader', dialect: 'mysql', command: 'adapter', readOnly: true }] } };
describe('host-reserved datasource commands', () => {
  it('hides only reserved commands, preserving ordinary plugin controls', () => {
    expect(publicPluginCommands(manifest).map((command) => command.id)).toEqual(['hello']);
    const allowed = new Set(publicPluginCommands(manifest).map((command) => command.id));
    expect(() => validateUINode({ type: 'button', command: 'adapter' }, allowed)).toThrow();
    expect(validateUINode({ type: 'button', command: 'hello' }, allowed)).toMatchObject({ command: 'hello' });
  });
  it('fails closed for malformed declarations without hiding plugin lifecycle records', () => {
    const malformed = { ...manifest, contributes: { ...manifest.contributes, dataSources: [{ command: null }] } } as unknown as PluginManifest;
    expect(publicPluginCommands(malformed)).toEqual([]); expect(malformed.id).toBe('demo.source');
  });
});
