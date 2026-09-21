import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('sidebar tree cursor', () => {
  it('uses the default arrow for tree rows while retaining active drag feedback', () => {
    const css = fs.readFileSync(new URL('../../v2-theme.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.gn-v2-explorer-tree-shell \.ant-tree-treenode\.ant-tree-treenode-draggable \{[^}]*cursor: default !important;/s);
    expect(css).toContain('cursor: grabbing !important;');
  });
});
