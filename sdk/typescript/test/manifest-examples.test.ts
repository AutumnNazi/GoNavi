import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifestParse.js';

function manifests(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...manifests(path));
    else if (name === 'gonavi.plugin.json') found.push(path);
  }
  return found;
}

describe('shipped example manifests', () => {
  it('parse with the public manifest parser', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/plugins');
    const paths = manifests(root);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const manifest = parseManifest(JSON.parse(readFileSync(path, 'utf8')));
      expect(manifest.id).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/);
    }
  });
});
