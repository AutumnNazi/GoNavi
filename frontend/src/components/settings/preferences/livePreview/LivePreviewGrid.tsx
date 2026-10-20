import { useState, type CSSProperties } from 'react';
import { Button, Input, Table, Tooltip, type TableColumnsType } from 'antd';
import { useStore } from '../../../../store';
import { useOptionalI18n } from '../../../../i18n/provider';
import { t as defaultTranslate } from '../../../../i18n';
import DataGridColumnTitle from '../../../DataGridColumnTitle';
import { GnRefreshIcon, GnTableIcon, GnSearchIcon } from '../../../icons/gnIcons';
import { getDensityParams, resolveDataTableColumnWidth, type DataTableDensity } from '../../../../utils/dataGridDisplay';
import { resolveDataGridDensityVariables } from '../../../../utils/dataGridDensity';
import type { PreviewRecord } from './previewData';

type Props = { rows: PreviewRecord[]; onChange: (rows: PreviewRecord[]) => void; table: string; density: DataTableDensity; rowNumbers: boolean; borders: boolean; onRefresh: () => void };
export function LivePreviewGrid({ rows, onChange, table, density, rowNumbers, borders, onRefresh }: Props) {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const darkMode = useStore(state => state.theme === 'dark');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ id: number; field: 'customer' | 'amount' | 'created_at' } | null>(null);
  const params = getDensityParams(density);
  const visible = rows.filter(row => Object.values(row).some(value => String(value).toLowerCase().includes(filter.toLowerCase())));
  const columns: TableColumnsType<PreviewRecord> = (['id', 'customer', 'amount', 'created_at'] as const).map(field => ({
    key: field, dataIndex: field, width: resolveDataTableColumnWidth({ density, manualWidth: null }), ellipsis: true,
    title: <DataGridColumnTitle columnName={field} columnMeta={{ type: field === 'id' ? 'bigint' : field === 'amount' ? 'decimal' : field === 'created_at' ? 'datetime' : 'varchar', key: field === 'id' ? 'PRI' : '' }}
      showColumnType showColumnComment={false} metaFontSize={params.metaFontSize} columnMetaHintColor="var(--gn-fg-4)" columnMetaTooltipColor="var(--gn-fg-2)" darkMode={darkMode} />,
    sorter: (a, b) => String(a[field]).localeCompare(String(b[field]), undefined, { numeric: true }),
    onCell: record => ({ onDoubleClick: () => { if (field !== 'id') setEditing({ id: record.id, field }); } }),
    render: (value: string | number, record) => editing?.id === record.id && editing.field === field ? <Input autoFocus size="small" value={String(value)}
      aria-label={t('settings.preview.edit_cell', { name: field })}
      onChange={event => onChange(rows.map(row => row.id === record.id ? { ...row, [field]: event.target.value } : row))}
      onBlur={() => setEditing(null)} onPressEnter={() => setEditing(null)} /> : <span className="data-grid-cell-value">{value}</span>,
  }));
  if (rowNumbers) columns.unshift({ key: 'row-number', title: '#', width: 42, render: (_value: unknown, _record, index) => <span className="data-grid-row-number">{index + 1}</span>, className: 'data-grid-row-number-cell' });
  return <div className="data-grid-root gn-v2-data-grid gn-live-grid" style={{ ...resolveDataGridDensityVariables(params), '--gonavi-header-min-height': `${params.headerMinHeight}px` } as CSSProperties} data-preview-density={density} data-preview-row-numbers={rowNumbers}>
    <div className="data-grid-toolbar-scroll gn-live-grid-toolbar"><GnTableIcon /><strong>{table}</strong><small>sales</small>
      <Tooltip title={t('data_grid.toolbar.refresh')}><Button size="small" aria-label={t('data_grid.toolbar.refresh')} icon={<GnRefreshIcon />} onClick={onRefresh} /></Tooltip>
      <Input size="small" prefix={<GnSearchIcon />} placeholder={t('settings.preview.filter')} aria-label={t('settings.preview.filter')} value={filter} onChange={event => setFilter(event.target.value)} allowClear />
    </div>
    <div className="gn-v2-data-grid-table-shell gn-live-grid-table"><div className="gn-v2-data-grid-table-wrap">
    <Table<PreviewRecord> rowKey="id" columns={columns} dataSource={visible} pagination={false} size="small" bordered={borders}
      scroll={{ x: 690 }} tableLayout="fixed" rowSelection={{ columnWidth: 36 }} />
    </div></div>
    <div className="gn-v2-data-grid-statusbar gn-live-grid-status"><span>{t('settings.preview.edit_hint')}</span><span>{visible.length} {t('settings.preview.records')}</span></div>
  </div>;
}
