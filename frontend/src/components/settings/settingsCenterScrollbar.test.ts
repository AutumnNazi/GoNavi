import { describe, expect, it } from 'vitest';

import { readV2ThemeCss } from '../../test/readV2ThemeCss';

const readCssRuleBlock = (css: string, selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`missing CSS rule: ${selector}`);
  }
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
};

describe('settings center scrollbar', () => {
  it('keeps an 8px thin WebKit bar', () => {
    const css = readV2ThemeCss();
    const scrollbarCss = readCssRuleBlock(
      css,
      'body[data-ui-version="v2"] .gonavi-settings-center-workbench-host ::-webkit-scrollbar,\nbody[data-ui-version="v2"] .gonavi-settings-center-workbench ::-webkit-scrollbar,\nbody[data-ui-version="v2"] .gonavi-settings-center-modal ::-webkit-scrollbar,\nbody[data-ui-version="v2"] .gn-v2-explorer-tree-shell .ant-tree-list-holder::-webkit-scrollbar',
    );
    const trackCss = readCssRuleBlock(
      css,
      'body[data-ui-version="v2"] .gonavi-settings-center-workbench-host ::-webkit-scrollbar-track,\nbody[data-ui-version="v2"] .gonavi-settings-center-workbench ::-webkit-scrollbar-track,\nbody[data-ui-version="v2"] .gonavi-settings-center-modal ::-webkit-scrollbar-track,\nbody[data-ui-version="v2"] .gn-v2-explorer-tree-shell .ant-tree-list-holder::-webkit-scrollbar-track',
    );

    expect(scrollbarCss).toContain('width: 8px;');
    expect(scrollbarCss).toContain('height: 8px;');
    expect(trackCss).toContain('--gn-bg-panel');
    expect(css).toMatch(
      /\.gonavi-settings-center-workbench-host,[\s\S]*?\.gn-v2-explorer-tree-shell \.ant-tree-list-holder \{[^}]*scrollbar-width: thin;/s,
    );
  });
});
