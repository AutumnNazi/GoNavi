import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataGrid from './DataGrid';
import { t } from '../i18n';
import { DATA_EXPORT_CSV_ENCODINGS } from './dataExportOptions';
import { backendApp, testRenderState } from './dataGridDdlTestState';
import { findButton, waitForEffects } from './dataGridDdlTestHelpers';
import { setUpDataGridDdlTest, tearDownDataGridDdlTest } from './dataGridDdlTestHooks';

vi.mock('../store', async () => (await import('./dataGridDdlTestState')).mockModule1());
vi.mock('../../wailsjs/go/app/App', async () => (await import('./dataGridDdlTestState')).mockModule2());
vi.mock('../../wailsjs/runtime/runtime', async () => (await import('./dataGridDdlTestState')).mockModule3());
vi.mock('react-dom', async () => (await import('./dataGridDdlTestState')).mockModule4());
vi.mock('@monaco-editor/react', async () => (await import('./dataGridDdlTestState')).mockModule5());
vi.mock('./ImportPreviewModal', async () => (await import('./dataGridDdlTestState')).mockModule6());
vi.mock('./TableDesigner', async () => (await import('./dataGridDdlTestState')).mockModule7());
vi.mock('@ant-design/icons', async () => (await import('./dataGridDdlTestState')).mockModule8());
vi.mock('@dnd-kit/core', async () => (await import('./dataGridDdlTestState')).mockModule9());
vi.mock('@dnd-kit/sortable', async () => (await import('./dataGridDdlTestState')).mockModule10());
vi.mock('@dnd-kit/utilities', async () => (await import('./dataGridDdlTestState')).mockModule11());
vi.mock('antd', async () => (await import('./dataGridDdlTestState')).mockModule12());

let renderer: ReactTestRenderer | undefined;
const option = (value: string) => renderer!.root.findByProps({ 'data-select-option': value });
const selectOption = async (value: string) => act(async () => option(value).props.onClick());
const startExport = async () => {
  await act(async () => findButton(renderer!, t('data_export.dialog.action.start')).props.onClick());
  await waitForEffects();
};

async function openDialog(scope = 'page') {
  await act(async () => {
    renderer = create(<DataGrid
      data={[{ __gonavi_row_key__: 'row-1', id: 1, name: 'alice' }]}
      columnNames={['id', 'name']} loading={false} tableName="users"
      exportScope="queryResult" resultSql="SELECT id, name FROM users"
      dbName="main" connectionId="conn-1"
    />);
  });
  await waitForEffects();
  if (scope === 'selected') {
    await act(async () => testRenderState.latestTableProps.rowSelection.onChange(['row-1']));
  }
  await act(async () => { findButton(renderer!, t('data_grid.toolbar.export')).props.onClick(); });
  await waitForEffects();
  await selectOption(scope);
}

beforeEach(() => {
  setUpDataGridDdlTest();
  backendApp.ExportDataWithOptions.mockResolvedValue({ success: true });
  backendApp.ExportQueryWithOptions.mockResolvedValue({ success: true });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  tearDownDataGridDdlTest();
});

describe('query result export dialog to backend options', () => {
  it('keeps XLSX default and hides CSV encoding until CSV is selected', async () => {
    await openDialog();
    expect(renderer!.root.findAllByProps({ 'data-select-option': 'utf-8-bom' })).toHaveLength(0);
    await startExport();
    expect(backendApp.ExportDataWithOptions).toHaveBeenCalledWith(
      [{ id: 1, name: 'alice' }], ['id', 'name'], 'users',
      expect.objectContaining({ format: 'xlsx', scope: 'page' }),
    );
    expect(backendApp.ExportDataWithOptions.mock.calls[0][3]).not.toHaveProperty('csvEncoding');
  });

  it('offers exactly the five CSV encodings and submits BOM by default', async () => {
    await openDialog();
    await selectOption('csv');
    for (const encoding of DATA_EXPORT_CSV_ENCODINGS) expect(option(encoding)).toBeTruthy();
    const encodingChoices = renderer!.root.findAll((node) => node.props['data-select-option']
      && DATA_EXPORT_CSV_ENCODINGS.includes(node.props['data-select-option']));
    expect(encodingChoices).toHaveLength(5);
    await startExport();
    expect(backendApp.ExportDataWithOptions.mock.calls[0][3]).toMatchObject({
      format: 'csv', csvEncoding: 'utf-8-bom', columns: ['id', 'name'], scope: 'page',
    });
  });

  it.each(DATA_EXPORT_CSV_ENCODINGS)('sends selected %s encoding to ExportDataWithOptions', async (encoding) => {
    await openDialog();
    await selectOption('csv');
    await selectOption(encoding);
    await startExport();
    expect(backendApp.ExportDataWithOptions.mock.calls[0][3]).toMatchObject({ format: 'csv', csvEncoding: encoding });
  });

  it.each(['selected', 'page', 'all'])('preserves %s scope through CSV backend submission', async (scope) => {
    await openDialog(scope);
    await selectOption('csv');
    await selectOption('gb18030');
    await startExport();
    const options = expect.objectContaining({ format: 'csv', csvEncoding: 'gb18030', columns: ['id', 'name'] });
    if (scope === 'all') {
      expect(backendApp.ExportQueryWithOptions).toHaveBeenCalledWith(
        expect.anything(), 'main', 'SELECT id, name FROM users', 'users', options,
      );
      expect(backendApp.ExportDataWithOptions).not.toHaveBeenCalled();
    } else {
      expect(backendApp.ExportDataWithOptions).toHaveBeenCalledWith(
        [{ id: 1, name: 'alice' }], ['id', 'name'], 'users', options,
      );
      expect(backendApp.ExportQueryWithOptions).not.toHaveBeenCalled();
    }
  });

  it.each(['parquet', 'json', 'xlsx', 'md', 'html', 'sql'])('drops CSV encoding after switching to %s', async (format) => {
    await openDialog();
    await selectOption('csv');
    await selectOption('utf-16le');
    await selectOption(format);
    expect(renderer!.root.findAllByProps({ 'data-select-option': 'utf-16le' })).toHaveLength(0);
    await startExport();
    const options = backendApp.ExportDataWithOptions.mock.calls[0][3];
    expect(options.format).toBe(format);
    expect(options).not.toHaveProperty('csvEncoding');
  });

  it('exports Parquet with the all-results query path', async () => {
    await openDialog('all');
    await selectOption('parquet');
    await startExport();
    expect(backendApp.ExportQueryWithOptions).toHaveBeenCalledWith(
      expect.anything(), 'main', 'SELECT id, name FROM users', 'users',
      expect.objectContaining({ format: 'parquet', columns: ['id', 'name'] }),
    );
    expect(backendApp.ExportQueryWithOptions.mock.calls[0][4]).not.toHaveProperty('csvEncoding');
  });
});
