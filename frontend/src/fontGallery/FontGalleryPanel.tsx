import { Alert, Button, Spin } from 'antd';
import { useMemo } from 'react';
import { useI18n } from '../i18n/provider';
import { useFontGalleryPanel } from './useFontGalleryPanel';
import { fontFamilyKey, systemHasFamily } from './options';
import { buildFontCatalogRows, type CatalogRow } from './catalogRows';
import { FontGalleryDetail } from './FontGalleryDetail';
import type { InstalledFontFamily } from '../utils/fontFamilies';
import './FontGalleryPanel.css';

interface Props {
  open: boolean;
  onToggle: () => void;
  installedFontFamilies: InstalledFontFamily[];
  onEnable: (kind: 'ui' | 'mono', cssFamily: string) => void;
  activeUi?: string | null;
  activeMono?: string | null;
}

export function FontGalleryPanel({ open, onToggle, installedFontFamilies, onEnable, activeUi, activeMono }: Props) {
  const { t, language } = useI18n();
  const gallery = useFontGalleryPanel(open);
  const rows = useMemo(() => buildFontCatalogRows(gallery.entries, installedFontFamilies, gallery.installed),
    [gallery.entries, installedFontFamilies, gallery.installed]);
  const nameOf = (row: CatalogRow) => row.names[language] || row.names['en-US'] || row.family;
  const selected = rows.find(row => row.id === gallery.selectedId) || rows[0] || null;
  const installed = (row: CatalogRow) => gallery.installed.find(item => item.entry.id === row.id || fontFamilyKey(item.entry.family) === fontFamilyKey(row.family));
  const local = (row: CatalogRow) => systemHasFamily(installedFontFamilies, row.family);
  const status = (row: CatalogRow) => local(row)
    ? t('app.theme.font_family.gallery.status_system')
    : installed(row) ? t('app.theme.font_family.gallery.status_downloaded')
      : t(row.remote ? 'app.theme.font_family.gallery.status_remote' : 'app.theme.font_family.gallery.status_catalog_pending');
  return <section className="gonavi-font-gallery" aria-label={t('app.theme.font_family.gallery.title')}>
    <Button type="link" onClick={onToggle}>{t(open ? 'app.theme.font_family.gallery.hide' : 'app.theme.font_family.gallery.browse')}</Button>
    {open && <div className="gonavi-font-gallery-body">
      <p className="gonavi-settings-inline-meta">{t('app.theme.font_family.gallery.description')}</p>
      <div className="gonavi-font-gallery-toolbar">
        <Button size="small" disabled={gallery.loading || Boolean(gallery.pending || gallery.previewState?.loading)} onClick={() => { void gallery.refresh(); }}>
          {t('app.theme.font_family.gallery.refresh')}
        </Button>
      </div>
      {gallery.loading && <div role="status"><Spin size="small" /> {t('app.theme.font_family.gallery.loading')}</div>}
      {gallery.error && <Alert type="error" showIcon role="alert" message={t(gallery.error)} />}
      {gallery.state.stale && <Alert type="warning" showIcon message={t('app.theme.font_family.gallery.stale')} />}
      <div className="gonavi-font-gallery-layout">
        <ul className="gonavi-font-gallery-list">
          {rows.map(row => <li key={row.id}>
            <button type="button" className={selected?.id === row.id ? 'is-active' : undefined} onClick={() => gallery.setSelectedId(row.id)}>
              <strong>{nameOf(row)}</strong><span>{status(row)}</span>
            </button>
          </li>)}
        </ul>
        {selected && <FontGalleryDetail key={selected.id} row={selected} name={nameOf(selected)} local={local(selected)}
          installed={installed(selected)} gallery={gallery} activeUi={activeUi} activeMono={activeMono} onEnable={onEnable} />}
      </div>
    </div>}
  </section>;
}
