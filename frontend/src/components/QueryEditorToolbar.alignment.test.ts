import { describe, expect, it } from 'vitest';
import { readV2ThemeCss } from '../test/readV2ThemeCss';

const toolbarSelector = 'body[data-ui-version="v2"] .gn-v2-query-toolbar';

const readRule = (selector: string): string => {
  const css = readV2ThemeCss();
  const start = css.indexOf(`${selector} {`);
  expect(start, `Missing CSS rule: ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start) + 1);
};

describe('QueryEditorToolbar control alignment', () => {
  it('keeps the Select root, visible selector and buttons at the same height for every density', () => {
    // Ant Design small/large Select roots otherwise remain 24/40px while the
    // toolbar selector is 32px, shifting the visible control at every zoom level.
    const root = readRule(`${toolbarSelector} .ant-select`);
    const selector = readRule(`${toolbarSelector} .ant-select-selector`);
    const button = readRule(`${toolbarSelector} .ant-btn`);

    for (const rule of [root, selector, button]) {
      expect(rule).toMatch(/\bheight:\s*32px\s*!important;/);
    }
  });

  it('centers Select arrows on the control instead of relying on a font-size offset', () => {
    const arrow = readRule(`${toolbarSelector} .ant-select-arrow`);

    expect(arrow).toMatch(/\btop:\s*50%;/);
    expect(arrow).toMatch(/\bmargin-top:\s*0;/);
    expect(arrow).toMatch(/\btransform:\s*translateY\(-50%\);/);
    expect(arrow).toMatch(/\bfont-size:\s*12px;/);
  });

  it('makes enabled arrows readable without overriding disabled, loading or search icons', () => {
    const enabledArrow = readRule(`${toolbarSelector} .ant-select:not(.ant-select-disabled) .ant-select-arrow`);
    const arrow = readRule(`${toolbarSelector} .ant-select-arrow`);

    expect(enabledArrow).toContain('color: var(--gn-fg-3);');
    expect(arrow).not.toContain('display: none');
    expect(arrow).not.toContain('content:');
    expect(arrow).not.toContain('color:');
  });
});
