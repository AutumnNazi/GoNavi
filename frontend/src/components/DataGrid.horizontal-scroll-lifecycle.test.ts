import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readDataGridSource = () => readFileSync(new URL('./DataGrid.tsx', import.meta.url), 'utf8');
const readDataGridStylesSource = () => readFileSync(new URL('./dataGridStyles.ts', import.meta.url), 'utf8');
const readVirtualListPatch = () => readFileSync(
  new URL('../../patches/rc-virtual-list+3.19.2.patch', import.meta.url),
  'utf8',
);

describe('DataGrid native horizontal scroll lifecycle', () => {
  it('keeps the native scrollbar while moving the header and sticky body from one DOM offset', () => {
    const source = readDataGridSource();
    const stylesSource = readDataGridStylesSource();
    const virtualListPatch = readVirtualListPatch();
    const nativeScrollHandlerIndex = source.indexOf('const handleTargetScroll = (event: Event)');
    const nativeScrollBindingSource = source.slice(
      source.lastIndexOf('useEffect(() => {', nativeScrollHandlerIndex),
      source.indexOf('const paginationControlTotal = useMemo', nativeScrollHandlerIndex),
    );
    const alignmentSource = source.slice(
      source.indexOf('const scheduleVirtualHorizontalAlignment = useCallback'),
      source.indexOf('const flushVirtualHorizontalWheel = useCallback'),
    );

    expect(source).toContain('nativeHorizontalScroll: isMacLike || isWindowsLike,');
    expect(source).toContain('const virtualListItemHorizontalOffsetComposited = isMacLike || isWindowsLike;');
    expect(source).toContain('const horizontalScrollVisible = isTableSurfaceActive && !isWindowsLike');
    expect(stylesSource).toContain('body[data-platform="windows"] .${gridId} .data-grid-external-horizontal-scroll');
    expect(virtualListPatch).toContain("position: horizontalOffsetComposited ? 'sticky' : 'relative'");
    expect(source).toContain('const nextBodyTranslate = `${-clampedOffset}px 0`;');
    expect(nativeScrollBindingSource).toContain("source?.classList.contains('ant-table-header')");
    expect(nativeScrollBindingSource).toContain('scheduleNativeVirtualHorizontalScroll(tableContainer);');
    expect(nativeScrollBindingSource).toContain('{ passive: true, capture: true }');
    expect(nativeScrollBindingSource).toContain("removeEventListener('scroll', handleTargetScroll, true)");
    expect(alignmentSource).toContain('? readVirtualHorizontalOffset(tableContainer)');
  });

  it('measures the first result layout before the browser paints the native scrollbar', () => {
    const source = readDataGridSource();
    const metricsEffect = source.slice(
      source.indexOf('useDataGridLayoutEffect(() => {', source.indexOf('// Dynamic Height')),
      source.indexOf('const [selectedRowKeys', source.indexOf('// Dynamic Height')),
    );

    expect(metricsEffect).toContain('return observeDataGridMetrics(el, recalculateTableMetrics);');
  });

  it('still reports whether a measurement applied', () => {
    const source = readDataGridSource();
    const metricsBody = source.slice(
      source.indexOf('const recalculateTableMetrics = useCallback'),
      source.indexOf('useDataGridLayoutEffect(() => {', source.indexOf('// Dynamic Height')),
    );

    // The callers need to know when the panel was not laid out yet, so the
    // early returns and the success path must stay explicit booleans.
    expect(metricsBody).toContain('if (!target) return false;');
    expect(metricsBody).toContain('const metrics = measureDataGridMetrics({');
    expect(metricsBody).toContain('if (!metrics) return false;');
    expect(metricsBody).toContain('if (metrics.tableHeight === null) return false;');
    expect(metricsBody).toContain('return true;');
  });

  it('keeps DOM measurement and first-valid scheduling outside the oversized component', () => {
    const source = readDataGridSource();
    expect(source).not.toContain("closest('.query-result-tabs .ant-tabs-content')");
    expect(source).not.toContain('new ResizeObserver');
  });

});
