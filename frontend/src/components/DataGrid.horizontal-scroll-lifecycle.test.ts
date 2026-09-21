import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildDataGridCssText } from './dataGridStyles';

/**
 * DataGrid 原生横向滚动生命周期的守卫断言。
 *
 * 依赖补丁（patches/*.patch）与生成的 CSS 无对应可执行代码，对其断言是最直接的验证方式；
 * 组件自身的实现细节断言已按 testPolicy 守卫移除——它们不执行被测代码，
 * 实测把逻辑改坏后仍会通过，且会因改名/格式化误报。
 */

const readVirtualListPatch = () => readFileSync(
  new URL('../../patches/rc-virtual-list+3.19.2.patch', import.meta.url),
  'utf8',
);

const buildCss = () => buildDataGridCssText({
  darkMode: false,
  densityParams: { dataFontSize: 12 },
  gridId: 'horizontal-scroll-grid',
  floatingScrollbarHeight: 8,
});

describe('DataGrid native horizontal scroll lifecycle', () => {
  it('keeps the native scrollbar while moving the header and sticky body from one DOM offset', () => {
    const virtualListPatch = readVirtualListPatch();
    const css = buildCss();

    expect(virtualListPatch).toContain("position: horizontalOffsetComposited ? 'sticky' : 'relative'");
    // Windows 隐藏浮动的外置滚动条，改用表格原生滚动条；其他平台保留外置轨道。
    expect(css).toContain('body[data-platform="windows"] .horizontal-scroll-grid .data-grid-external-horizontal-scroll');
    expect(css).toContain('.horizontal-scroll-grid .data-grid-external-horizontal-scroll');
  });

  it('keeps the macOS overlay track for the composited native holder', () => {
    const css = buildCss();

    expect(css).toContain(
      'body[data-platform="darwin"] .horizontal-scroll-grid .ant-table-tbody-virtual-holder[data-horizontal-scroll-native="true"]::-webkit-scrollbar',
    );
  });
});
