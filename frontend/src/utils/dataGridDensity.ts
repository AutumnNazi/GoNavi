import { getDensityParams } from './dataGridDisplay';

type DensityGeometry = Partial<Pick<ReturnType<typeof getDensityParams>, 'rowHeight' | 'headerMinHeight' | 'cellPadding'>>;
const MIN_ROW_HEIGHT = 22;

// 表格样式、虚拟滚动和设置预览使用同一组尺寸；字号仍由用户的字体设置控制。
export function resolveDataGridRowHeight(density: DensityGeometry = {}, uiScale = 1): number {
  const scale = Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1;
  return Math.max(MIN_ROW_HEIGHT, (density.rowHeight ?? getDensityParams('comfortable').rowHeight) * scale);
}

export function resolveDataGridDensityVariables(density: DensityGeometry = {}): Record<`--${string}`, string> {
  const defaults = getDensityParams('comfortable');
  const padding = (density.cellPadding ?? defaults.cellPadding).trim().split(/\s+/);
  const horizontal = Number.parseFloat(padding[padding.length - 1]);
  return {
    '--gn-data-table-row-height': `max(${MIN_ROW_HEIGHT}px, calc(${density.rowHeight ?? defaults.rowHeight}px * var(--gn-ui-scale, 1)))`,
    '--gn-data-table-header-height': `calc(${(density.headerMinHeight ?? defaults.headerMinHeight) + 8}px * var(--gn-ui-scale, 1))`,
    '--gn-data-table-header-inner-height': `calc(${(density.headerMinHeight ?? defaults.headerMinHeight) + 8}px * var(--gn-ui-scale, 1) - 1px)`,
    '--gn-data-table-cell-inline-padding': `calc(${horizontal}px * var(--gn-ui-scale, 1))`,
  };
}

export function buildDataGridDensityCss(selector: string, density: DensityGeometry): string {
  return `${selector} {${Object.entries(resolveDataGridDensityVariables(density)).map(([name, value]) => `${name}: ${value};`).join('')}}`;
}
