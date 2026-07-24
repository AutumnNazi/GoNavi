import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('SQL audit workbench wiring', () => {
  it('routes one stable sql-audit tab through the workbench shell', () => {
    const typesSource = read('../../types.ts');
    const tabSource = read('../../utils/sqlAuditTab.ts');
    const workbenchSource = read('../WorkbenchTabContent.tsx');

    expect(typesSource).toContain('| "sql-audit"');
    expect(tabSource).toContain("SQL_AUDIT_WORKBENCH_TAB_ID = 'sql-audit-center'");
    expect(workbenchSource).toContain("tab.type === 'sql-audit'");
    expect(workbenchSource).toContain('<SqlAuditWorkbench tab={tab} isActive={isActive} />');
  });

  it('provides both the V2 footer shortcut and the cross-version settings-center entry', () => {
    const sidebarSource = read('../Sidebar.tsx');
    const railSource = read('../sidebar/SqlAuditRailButton.tsx');
    const appSource = read('../../App.tsx');

    expect(sidebarSource).toContain('gn-v2-sidebar-sql-audit-button');
    expect(railSource).toContain('buildSqlAuditWorkbenchTab()');
    expect(appSource).toContain("key: 'sql-audit'");
    expect(appSource).toContain('addTab(buildSqlAuditWorkbenchTab())');
    expect(appSource).toContain('handleCancelSettingsCenterPane();');
  });

  it('registers audit labels for docked and detached tab presentations', () => {
    expect(read('../TabManager.tsx')).toContain("tab_manager.kind_badge.sql_audit");
    expect(read('../FloatingWorkbenchWindows.tsx')).toContain("tab_manager.kind_badge.sql_audit");
    expect(read('../../utils/tabDisplay.ts')).toContain("if (tab.type === 'sql-audit') return 'AUDIT'");
  });

  it('keeps audit RPC calls on the runtime bridge rather than generated desktop-only imports', () => {
    const rpcSource = read('./sqlAuditRpc.ts');
    const workbenchSource = read('./SqlAuditWorkbench.tsx');

    expect(rpcSource).toContain('(window as any).go?.app?.App');
    expect(rpcSource).toContain('GetSQLAuditHealth?: ()');
    expect(workbenchSource).not.toContain("from '../../../wailsjs/go/app/App'");
  });
});
