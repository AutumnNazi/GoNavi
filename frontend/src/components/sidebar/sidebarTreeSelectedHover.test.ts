import { describe, expect, it } from 'vitest';

import { readV2ThemeCss } from '../../test/readV2ThemeCss';

describe('sidebar selected tree row hover', () => {
  it('reserves font-relative vertical space for descenders while keeping labels ellipsized', () => {
    const css = readV2ThemeCss();
    expect(css).toMatch(/\.gn-v2-tree-title\s*\{[^}]*line-height:\s*1\.5;/s);
    expect(css).toMatch(/\.gn-v2-tree-label\s*\{[^}]*text-overflow:\s*ellipsis;/s);
  });
  it('keeps generic full-row hover and active styles off selected nodes', () => {
    const css = readV2ThemeCss();

    expect(css).toMatch(
      /\.ant-tree-treenode:not\(\.ant-tree-treenode-selected\):has\(\.gn-v2-tree-title:not\(\.is-mono\)\):hover \{/,
    );
    expect(css).toMatch(
      /\.ant-tree-treenode:not\(\.ant-tree-treenode-selected\):has\(\.gn-v2-tree-title:not\(\.is-mono\)\):active \{/,
    );
    expect(css).toMatch(
      /\.ant-tree-treenode\.ant-tree-treenode-selected:hover \{[^}]*var\(--gn-bg-selected\)/s,
    );
  });
});
