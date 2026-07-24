import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hookSource = readFileSync(new URL('./sidebar/useSidebarBatchExport.ts', import.meta.url), 'utf8');
const objectActionsSource = readFileSync(new URL('./sidebar/useSidebarObjectActions.tsx', import.meta.url), 'utf8');
const tableOverviewSource = readFileSync(new URL('./TableOverview.tsx', import.meta.url), 'utf8');
const workbenchSource = readFileSync(new URL('./TableExportWorkbench.tsx', import.meta.url), 'utf8');
const bindingSource = readFileSync(new URL('../../wailsjs/go/app/App.d.ts', import.meta.url), 'utf8');
const modelSource = readFileSync(new URL('../../wailsjs/go/models.ts', import.meta.url), 'utf8');

describe('Sidebar SQL export options', () => {
  it('opens database and table backups for review while retaining schema confirmation', () => {
    expect(hookSource).toContain('buildDatabaseExportWorkbenchTab({');
    expect(hookSource).toContain('buildSchemaExportWorkbenchTab({');
    expect(hookSource).toContain('buildBatchTableExportWorkbenchTab({');
    expect(hookSource).toContain('buildBatchDatabaseExportWorkbenchTab({');
    expect(hookSource.match(/showSQLExportOptionsDialog\(\)/g)).toHaveLength(1);
    expect(hookSource).toContain("launchKey: createTableExportKey('database')");
    expect(hookSource).toContain('const openBatchTableWorkbench = () =>');
    expect(hookSource).toContain('const openBatchDatabaseWorkbench = () =>');
    expect(objectActionsSource).toContain("if (options.format === 'sql')");
    expect(objectActionsSource).toContain("await openTableSQLExportWorkbench(node, 'backup')");
    expect(objectActionsSource).toContain("await openTableSQLExportWorkbench(node, 'dataOnly')");
    expect(objectActionsSource).not.toContain('showSQLExportOptionsDialog');
    expect(objectActionsSource).toContain("...(mode === 'backup' ? { launchKey } : { requestKey: launchKey })");
    expect(objectActionsSource).toContain('includeDropIfExists: false');
    expect(tableOverviewSource).not.toContain('showSQLExportOptionsDialog');
    expect(tableOverviewSource).toContain("...(mode === 'backup' ? { launchKey } : { requestKey: launchKey })");
    expect(workbenchSource).toContain('const [includeDropIfExists, setIncludeDropIfExists] = useState(');
    expect(workbenchSource).toContain('includeDropIfExists: includeSchema && includeDropIfExists');
    expect(workbenchSource).toContain('includeDropIfExists,');
    expect(workbenchSource).toContain('includeDatabaseContext,');
    expect(workbenchSource).toContain('onChange={(event) => setIncludeDropIfExists(event.target.checked)}');
  });

  it('keeps the Wails option and typed single-database/schema methods in sync', () => {
    expect(bindingSource).toContain('ExportDatabaseSQLWithOptions(');
    expect(bindingSource).toContain('ExportSchemaSQLWithOptions(');
    expect(modelSource).toContain('includeDropIfExists?: boolean;');
    expect(modelSource).toContain('this.includeDropIfExists = source["includeDropIfExists"]');
    expect(modelSource).toContain('includeDatabaseContext?: boolean;');
    expect(modelSource).toContain('this.includeDatabaseContext = source["includeDatabaseContext"]');
  });
});
