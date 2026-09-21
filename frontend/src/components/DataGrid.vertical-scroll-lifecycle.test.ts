import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildDataGridCssText } from './dataGridStyles';

/**
 * DataGrid 原生竖向滚动生命周期的守卫断言。
 *
 * 依赖补丁（patches/*.patch）与生成的 CSS 无对应可执行代码，对其断言是最直接的验证方式；
 * 组件自身的实现细节断言已按 testPolicy 守卫移除——它们不执行被测代码，
 * 实测把逻辑改坏（如守卫恒返回 false）后仍会通过。
 */

const readDependencyPatch = () => readFileSync(
  new URL('../../patches/rc-virtual-list+3.19.2.patch', import.meta.url),
  'utf8',
);
const readTableDependencyPatch = () => readFileSync(
  new URL('../../patches/rc-table+7.54.0.patch', import.meta.url),
  'utf8',
);

const buildCss = () => buildDataGridCssText({
  darkMode: false,
  densityParams: { dataFontSize: 12 },
  gridId: 'vertical-scroll-grid',
  floatingScrollbarHeight: 8,
});

describe('DataGrid native vertical scroll lifecycle', () => {
  it('keeps the Windows scrollbar native while reducing mounted columns during active scrolling', () => {
    const listPatch = readDependencyPatch();
    const tablePatch = readTableDependencyPatch();

    expect(listPatch).toContain('markNativeScrollMoving();');
    expect(listPatch).toContain('var fixedOverscanRows = 2;');
    expect(listPatch).toContain('scrolling: renderScrolling');
    expect(listPatch).toContain('componentRef.current.scrollLeft : offsetLeft');
    expect(listPatch).toContain('x: isRTL ? -liveOffsetLeft : liveOffsetLeft');
    expect(tablePatch).toContain('virtualizeDuringNativeVerticalScroll');
    expect(tablePatch).toContain('leadingOverscanWidth: virtualizeDuringNativeVerticalScroll ? 0 : undefined');
    expect(tablePatch).toContain('resolveBodyLineColumnVirtualWindow(itemProps.offsetX, itemProps.scrolling)');
  });

  it('advances the virtual scrollbar only through the controlled holder', () => {
    const css = buildCss();

    // 受控滚动条由 data-virtual-scrollbar-controlled 标记开启，是原生滚动条让位的依据。
    expect(css).toContain('[data-virtual-scrollbar-controlled="true"]');
  });
});
