import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TableOverview v2 context menu', () => {
  it('renders card and list table context menus through a measured portal', () => {
    const source = readFileSync(new URL('./TableOverview.tsx', import.meta.url), 'utf8');
    const cardSource = source.slice(
      source.indexOf('const renderCardTableContent = (table: TableStatRow) => ('),
      source.indexOf('const renderListTable = (table: TableStatRow) => {'),
    );
    const listSource = source.slice(
      source.indexOf('const renderListTable = (table: TableStatRow) => {'),
      source.indexOf('if (loading) {'),
    );

    expect(source).toContain("import { createPortal } from 'react-dom';");
    expect(source).toContain('resolveOverviewContextMenuPosition(event.clientX, event.clientY)');
    expect(source).toContain('v2ContextMenuPortalRef');
    expect(source).toContain('content?.scrollHeight');
    expect(source).toContain('gn-v2-table-overview-context-menu-portal');
    expect(source).toContain("['--gn-v2-context-menu-max-height' as any]");
    expect(source).toContain('renderV2OverviewTableContextMenu(v2ContextMenuTable)');
    expect(cardSource).toContain('onContextMenu={isV2Ui ? (event) => openV2OverviewContextMenu(event, table) : undefined}');
    expect(listSource).toContain('onContextMenu={isV2Ui ? (event) => openV2OverviewContextMenu(event, table) : undefined}');
    expect(cardSource).not.toContain('popupRender');
    expect(listSource).not.toContain('popupRender');
  });

  it('opens table backups for review while retaining automatic INSERT exports', () => {
    const source = readFileSync(new URL('./TableOverview.tsx', import.meta.url), 'utf8');

    expect(source).toContain('buildBatchTableExportWorkbenchTab({');
    expect(source).not.toContain('showSQLExportOptionsDialog');
    expect(source).toContain('initialObjectNames: [normalizedTableName]');
    expect(source).toContain('contentMode: mode');
    expect(source).toContain('includeDropIfExists: false');
    expect(source).toContain("...(mode === 'backup' ? { launchKey } : { requestKey: launchKey })");
    expect(source).toContain("await openTableSQLExportWorkbench(tableName, 'dataOnly')");
    expect(source).toContain("void openTableSQLExportWorkbench(tableName, 'backup')");
    expect(source).toContain("onClick: () => openTableSQLExportWorkbench(table.name, 'backup')");
    expect(source).not.toContain('ExportTableWithOptions');
    expect(source).not.toContain('useExportProgressDialog');
    expect(source).not.toContain('{exportProgressModal}');
  });
});
