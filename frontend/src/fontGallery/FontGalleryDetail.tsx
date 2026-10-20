import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { useI18n } from '../i18n/provider';
import { loadDownloadedFont } from './faces';
import { fontGalleryErrorKey } from './errors';
import { fontEntryKey, type useFontGalleryPanel } from './useFontGalleryPanel';
import { getPrimaryFontFamily } from '../utils/fontFamilyDisplay';
import type { CatalogRow } from './catalogRows';
import type { FontInstalled } from './types';

interface Props {
  row: CatalogRow;
  local: boolean;
  installed?: FontInstalled;
  name: string;
  gallery: ReturnType<typeof useFontGalleryPanel>;
  activeUi?: string | null;
  activeMono?: string | null;
  onEnable: (kind: 'ui' | 'mono', family: string) => void;
}

export function FontGalleryDetail({ row, local, installed, name, gallery, activeUi, activeMono, onEnable }: Props) {
  const { t } = useI18n();
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const entry = installed?.entry ?? row.remote;
  const preview = entry && gallery.previewState?.key === fontEntryKey(entry) ? gallery.previewState : null;
  const busy = Boolean(gallery.pending || gallery.previewState?.loading || gallery.loading || activating);
  const inUse = installed && [activeUi, activeMono].some(value => value && getPrimaryFontFamily(value) === installed.family);
  const useFont = async () => {
    setActivationError(null); setActivating(true);
    try {
      if (installed) await loadDownloadedFont(installed);
      if (mounted.current && (installed || local)) onEnable(row.kind, installed?.family ?? row.family);
    } catch (error) { if (mounted.current) setActivationError(fontGalleryErrorKey(error)); }
    finally { if (mounted.current) setActivating(false); }
  };
  const download = async () => {
    if (!row.remote) return;
    const result = await gallery.download(row.remote);
    if (result && mounted.current) onEnable(result.entry.kind, result.family);
  };
  return <div className="gonavi-font-gallery-detail">
    <h4>{name}</h4>
    <p>{row.description}</p>
    <p className="gonavi-settings-inline-meta">{row.useCase}</p>
    <p className="gonavi-settings-inline-meta">{row.licenseName}</p>
    <div className="gonavi-font-gallery-preview">
      {local || preview?.family ? (
        <p style={{ fontFamily: '"' + (local ? row.family : preview?.family) + '"' }}>{t(row.kind === 'mono' ? 'app.theme.font_family.preview_mono' : 'app.theme.font_family.preview_ui')}</p>
      ) : <p className="gonavi-settings-inline-meta">{t(entry ? 'app.theme.font_family.gallery.preview_idle' : 'app.theme.font_family.gallery.pending_download')}</p>}
      {preview?.error && <Alert type="error" showIcon message={t(preview.error)} />}
      {activationError && <Alert type="error" showIcon message={t(activationError)} />}
    </div>
    <div className="gonavi-font-gallery-actions">
      {entry && !local && <Button size="small" disabled={busy} onClick={() => { void gallery.preview(entry, installed); }}>
        {t('app.theme.font_family.gallery.preview')}
      </Button>}
      {!local && !installed && row.remote && <Button size="small" type="primary" disabled={busy} onClick={() => { void download(); }}>
        {t('app.theme.font_family.gallery.download')}
      </Button>}
      {(installed || local) && <Button size="small" disabled={busy} onClick={() => { void useFont(); }}>
        {t('app.theme.font_family.gallery.use')}
      </Button>}
      {installed && !inUse && <Button size="small" danger disabled={busy} onClick={() => { void gallery.remove(installed.entry); }}>
        {t('app.theme.font_family.gallery.remove')}
      </Button>}
    </div>
  </div>;
}
