import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifestParse.js';
const base = { schemaVersion: 1, apiVersion: 1, id: 'example.host', name: 'Host', version: '1.0.0', permissions: [] };
describe('manifest field labels', () => {
  it('names a short printable unknown field and hides a long one', () => {
    expect(() => parseManifest({ ...base, bogus: 1 })).toThrow('unknown manifest field "bogus"');
    expect(() => parseManifest({ ...base, ['文'.repeat(80)]: 1 })).toThrow(/^unknown manifest field$/);
  });
});
