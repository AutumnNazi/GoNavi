import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workbenchCss = readFileSync(new URL('../styles/v2-theme-workbench.css', import.meta.url), 'utf8');
const designerSource = readFileSync(new URL('./TableDesigner.tsx', import.meta.url), 'utf8');

describe('TableDesigner theme surfaces', () => {
  it('uses the same workbench panel token as the data preview grid', () => {
    expect(workbenchCss).toContain('.gn-v2-table-designer {');
    expect(workbenchCss).toContain('background: var(--gn-bg-panel-2);');
    expect(workbenchCss).toContain('.gn-v2-table-designer.is-embedded {');
    expect(workbenchCss).toContain('background: var(--gn-bg-panel-2) !important;');
    expect(workbenchCss).toContain('.gn-v2-table-designer .ant-table-content {');
    expect(designerSource).toContain("const panelBodyBg = 'var(--gn-bg-panel-2)';");
    expect(designerSource).toContain("const focusRowBg = 'var(--gn-bg-selected)';");
    expect(designerSource).toContain('background: var(--gn-bg-hover) !important;');
  });

  it('keeps the select-all checkbox on the same vertical axis as row checkboxes', () => {
    expect(workbenchCss).toContain('.ant-table-thead > tr > th.table-designer-select-column');
    expect(workbenchCss).toContain('.ant-table-tbody > tr > td.table-designer-select-column');
    expect(workbenchCss).toContain('padding: 0 !important;');
  });

  it('follows the workspace data-table vertical border switch', () => {
    expect(designerSource).toContain('resolveDataTableVerticalBorderColor');
    expect(designerSource).toContain('appearance.showDataTableVerticalBorders === true');
    expect(designerSource).toContain('border-inline-end: var(--gn-data-table-vertical-border, none) !important;');
  });
});
