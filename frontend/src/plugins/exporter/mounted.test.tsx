import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataGrid from '../../components/DataGrid';
import { t } from '../../i18n';
import { invalidatePluginContributions } from '../invalidation';
import { messageApi } from '../../components/dataGridDdlTestState';
import { backendApp, testRenderState } from '../../components/dataGridDdlTestState';
import { findButton, waitForEffects } from '../../components/dataGridDdlTestHelpers';
import { setUpDataGridDdlTest, tearDownDataGridDdlTest } from '../../components/dataGridDdlTestHooks';

vi.mock('../../store', async () => (await import('../../components/dataGridDdlTestState')).mockModule1());
vi.mock('../../../wailsjs/go/app/App', async () => (await import('../../components/dataGridDdlTestState')).mockModule2());
vi.mock('../../../wailsjs/runtime/runtime', async () => (await import('../../components/dataGridDdlTestState')).mockModule3());
vi.mock('react-dom', async () => (await import('../../components/dataGridDdlTestState')).mockModule4());
vi.mock('@monaco-editor/react', async () => (await import('../../components/dataGridDdlTestState')).mockModule5());
vi.mock('../../components/ImportPreviewModal', async () => (await import('../../components/dataGridDdlTestState')).mockModule6());
vi.mock('../../components/TableDesigner', async () => (await import('../../components/dataGridDdlTestState')).mockModule7());
vi.mock('@ant-design/icons', async () => (await import('../../components/dataGridDdlTestState')).mockModule8());
vi.mock('@dnd-kit/core', async () => (await import('../../components/dataGridDdlTestState')).mockModule9());
vi.mock('@dnd-kit/sortable', async () => (await import('../../components/dataGridDdlTestState')).mockModule10());
vi.mock('@dnd-kit/utilities', async () => (await import('../../components/dataGridDdlTestState')).mockModule11());
vi.mock('antd', async () => (await import('../../components/dataGridDdlTestState')).mockModule12());

const format = 'plugin:sdk.example:ndjson';
const entry = (generation = 1) => ({ format, pluginId: 'sdk.example', id: 'ndjson', name: 'NDJSON', extension: 'ndjson', contentType: 'application/x-ndjson', version: '1.0.0', digest: 'a'.repeat(64), generation, available: true, state: 'running' });
let renderer: ReactTestRenderer | undefined;
let rows: Array<Record<string, unknown>>;
const choose = async (value: string) => { await act(async () => renderer!.root.findByProps({ 'data-select-option': value }).props.onClick()); };
const start = async () => { await act(async () => findButton(renderer!, t('data_export.dialog.action.start')).props.onClick()); await waitForEffects(); };
async function open(scope = 'page') {
  await act(async () => { renderer = create(<DataGrid data={rows} columnNames={['id', 'nested', 'secret']} loading={false} tableName="users" exportScope="queryResult" resultSql="SELECT id, nested, secret FROM users" dbName="main" connectionId="conn-1" />); });
  await waitForEffects();
  if (scope === 'selected') await act(async () => testRenderState.latestTableProps.rowSelection.onChange(['row-1']));
  await act(async () => { findButton(renderer!, t('data_grid.toolbar.export')).props.onClick(); }); await waitForEffects(); await choose(scope); await choose(format);
}
beforeEach(() => {
  setUpDataGridDdlTest(); rows = [{ __gonavi_row_key__: 'row-1', id: 1, nested: { label: 'original' }, secret: 'not selected' }, { __gonavi_row_key__: 'row-2', id: 2, nested: null, secret: 'second secret' }];
  backendApp.PluginExporters.mockResolvedValue({ success: true, data: { items: [entry()] } }); backendApp.ExportDataWithOptions.mockResolvedValue({ success: true });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; tearDownDataGridDdlTest(); });
describe('actual DataGrid plugin query-result snapshot route', () => {
  it.each(['selected', 'page'])('exports %s without SQL, strips unselected data and sends only minimal options', async (scope) => {
    await open(scope);
    const columns = renderer!.root.findAll((node) => node.props.mode === 'multiple').find((node) => typeof node.props.onChange === 'function')!;
    await act(async () => columns.props.onChange(['nested', 'id'])); await start();
    expect(backendApp.ExportQueryWithOptions).not.toHaveBeenCalled(); expect(backendApp.DBQuery).not.toHaveBeenCalled(); expect(backendApp.ExportDataWithOptions).toHaveBeenCalledOnce();
    const [data, names, , options] = backendApp.ExportDataWithOptions.mock.calls[0];
    expect(names).toEqual(['nested', 'id']); expect(data).toHaveLength(scope === 'selected' ? 1 : 2); expect(data[0]).toEqual({ nested: { label: 'original' }, id: 1 });
    expect(data[0]).not.toHaveProperty('__gonavi_row_key__'); expect(data[0]).not.toHaveProperty('secret');
    expect(options.pluginExporter).toEqual({ digest: 'a'.repeat(64), generation: 1 });
    expect(Object.keys(options).sort()).toEqual(['columns', 'format', 'jobId', 'pluginExporter', 'totalRowsHint', 'totalRowsKnown'].sort());
    (rows[0].nested as { label: string }).label = 'changed'; expect(data[0].nested.label).toBe('original'); expect(Object.isFrozen(data[0].nested)).toBe(true);
  });
  it('rejects all scope instead of silently choosing page or reexecuting SQL', async () => {
    await open('all'); expect(renderer!.root.findByProps({ 'data-select-option': 'all' }).props.disabled).toBe(true); await start();
    expect(backendApp.ExportDataWithOptions).not.toHaveBeenCalled(); expect(backendApp.ExportQueryWithOptions).not.toHaveBeenCalled(); expect(messageApi.error).toHaveBeenCalled();
  });
  it('requires explicit same-value reselection after current metadata changes', async () => {
    await open(); backendApp.PluginExporters.mockResolvedValue({ success: true, data: { items: [entry(2)] } });
    await act(async () => findButton(renderer!, t('plugin.exporter.refresh')).props.onClick()); await waitForEffects(); await start();
    expect(backendApp.ExportDataWithOptions).not.toHaveBeenCalled(); await choose(format); await start();
    expect(backendApp.ExportDataWithOptions.mock.calls[0][3].pluginExporter.generation).toBe(2);
  });
  it('does not invoke after root invalidation even when the package pin can repeat', async () => {
    await open(); await act(async () => invalidatePluginContributions({ reason: 'root' })); await start(); expect(backendApp.ExportDataWithOptions).not.toHaveBeenCalled();
  });
  it('refuses unsafe materialized integers before a host export call', async () => {
    rows[0].id = Number.MAX_SAFE_INTEGER + 1; await open(); await start(); expect(backendApp.ExportDataWithOptions).not.toHaveBeenCalled(); expect(messageApi.error).toHaveBeenCalled();
  });
});
