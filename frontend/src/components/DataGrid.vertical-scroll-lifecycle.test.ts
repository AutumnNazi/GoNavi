import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readDependencyPatch = () => readFileSync(
  new URL('../../patches/rc-virtual-list+3.19.2.patch', import.meta.url),
  'utf8',
);
const readTableDependencyPatch = () => readFileSync(
  new URL('../../patches/rc-table+7.54.0.patch', import.meta.url),
  'utf8',
);
const readDataGridSource = () => readFileSync(new URL('./DataGrid.tsx', import.meta.url), 'utf8');
const readDataGridStylesSource = () => readFileSync(new URL('./dataGridStyles.ts', import.meta.url), 'utf8');

describe('DataGrid native vertical scroll lifecycle', () => {
  it('keeps the Windows scrollbar native while reducing mounted columns during active scrolling', () => {
    const source = readDataGridSource();
    const listPatch = readDependencyPatch();
    const tablePatch = readTableDependencyPatch();
    const stylesSource = readDataGridStylesSource();

    expect(source).toContain('const virtualListItemNativeScrollbarControlled = isMacLike && virtualListItemHeightFixed;');
    expect(listPatch).toContain('markNativeScrollMoving();');
    expect(listPatch).toContain('var fixedOverscanRows = 2;');
    expect(listPatch).toContain('scrolling: renderScrolling');
    expect(listPatch).toContain('componentRef.current.scrollLeft : offsetLeft');
    expect(listPatch).toContain('x: isRTL ? -liveOffsetLeft : liveOffsetLeft');
    expect(tablePatch).toContain('virtualizeDuringNativeVerticalScroll');
    expect(tablePatch).toContain('leadingOverscanWidth: virtualizeDuringNativeVerticalScroll ? 0 : undefined');
    expect(tablePatch).toContain('resolveBodyLineColumnVirtualWindow(itemProps.offsetX, itemProps.scrolling)');
    expect(stylesSource).toContain('.ant-table-tbody-virtual-holder:active > div > .ant-table-tbody-virtual-holder-inner');
    expect(stylesSource).toContain('transform: none !important;');
  });
});
