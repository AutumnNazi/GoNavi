import { useEffect, useState } from 'react';
import { Button, Checkbox } from 'antd';
import { useStore } from '../../../store';
import { useOptionalI18n } from '../../../i18n/provider';
import { t as defaultTranslate } from '../../../i18n';
import type { DataTableDensity } from '../../../utils/dataGridDisplay';
import { PreviewSurface } from './livePreview/PreviewSurface';
import { LivePreviewGrid } from './livePreview/LivePreviewGrid';
import { PREVIEW_RECORDS } from './livePreview/previewData';
import './preferencePreviews.css';

export function TablePreferencePreview() {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const activeDensity = useStore(state => state.appearance.dataTableDensity);
  const activeRows = useStore(state => state.appearance.showDataTableRowNumber);
  const mode = useStore(state => state.appearance.uiLayoutMode);
  const borders = useStore(state => state.appearance.showDataTableVerticalBorders);
  const setAppearance = useStore(state => state.setAppearance);
  const [density, setDensity] = useState(activeDensity);
  const [rowNumbers, setRowNumbers] = useState(activeRows);
  const [records, setRecords] = useState(PREVIEW_RECORDS.orders);
  useEffect(() => setDensity(activeDensity), [activeDensity]);
  useEffect(() => setRowNumbers(mode === 'navicat' ? false : activeRows), [activeRows, mode]);
  const changed = density !== activeDensity || (mode !== 'navicat' && rowNumbers !== activeRows);
  return <section className="gn-preference-preview" aria-label={t('settings.preview.table')}>
    <div className="gn-preview-heading"><div><h4>{t('settings.preview.table')}</h4><p>{t('settings.preview.only')}</p></div>
      <div className="gn-preview-choices" role="group" aria-label={t('app.theme.data_table.density')}>
        {(['comfortable', 'standard', 'compact'] as DataTableDensity[]).map(value => <button type="button" key={value} aria-pressed={density === value} onClick={() => setDensity(value)}>{t(`app.theme.data_table.density.${value}`)}</button>)}
      </div>
    </div>
    <div className="gn-preview-table-options"><Checkbox disabled={mode === 'navicat'} checked={rowNumbers} onChange={event => setRowNumbers(event.target.checked)}>{t('app.theme.data_table.row_number')}</Checkbox>
      {mode === 'navicat' && <small>{t('settings.preview.navicat_rows_hint')}</small>}
    </div>
    <PreviewSurface mode={mode} height={330} label={t('settings.preview.sample_table')}>
      <LivePreviewGrid rows={records} onChange={setRecords} table="orders" density={density} rowNumbers={rowNumbers} borders={borders} onRefresh={() => setRecords(PREVIEW_RECORDS.orders)} />
    </PreviewSurface>
    <div className="gn-preview-footer"><span>{t('settings.preview.sample_hint')}</span>
      <Button size="small" disabled={!changed} onClick={() => setAppearance({ dataTableDensity: density, ...(mode !== 'navicat' ? { showDataTableRowNumber: rowNumbers } : {}) })}>{t(changed ? 'settings.preview.apply_table' : 'settings.preview.current')}</Button>
    </div>
  </section>;
}
