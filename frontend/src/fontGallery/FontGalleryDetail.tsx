import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { useI18n } from '../i18n/provider';
import { loadDownloadedFont } from './faces';
import { fontGalleryErrorKey } from './errors';
import { fontEntryKey, type useFontGalleryPanel } from './useFontGalleryPanel';
import { cssStack } from './options';
import { FontFamilyPreview } from '../appShell/settings/FontFamilyPreview';
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
  // 已下载/系统字体必须走与应用后完全一致的 cssStack 解析链，库内预览才与实际生效效果一致；
  // 仅未下载的远程字体用预览别名（GoNaviFontPreview-*）临时渲染。
  const previewFamily = installed ? cssStack(installed.family, row.kind)
    : local ? cssStack(row.family, row.kind)
      : preview?.family ? '"' + preview.family + '"' : null;
  const busy = Boolean(gallery.pending || gallery.previewState?.loading || gallery.loading || activating);
  const inUse = installed && [activeUi, activeMono].some(value => value && getPrimaryFontFamily(value) === installed.family);
  const applyFont = async () => {
    setActivationError(null); setActivating(true);
    try {
      if (installed) await loadDownloadedFont(installed);
      if (mounted.current && (installed || local)) {
        onEnable('ui', installed?.family ?? row.family);
        onEnable('mono', installed?.family ?? row.family);
      }
    } catch (error) { if (mounted.current) setActivationError(fontGalleryErrorKey(error)); }
    finally { if (mounted.current) setActivating(false); }
  };
  const download = async () => {
    if (!row.remote) return;
    const result = await gallery.download(row.remote);
    if (result && mounted.current) onEnable(result.entry.kind, result.family);
  };
  return <>
    <div className="gonavi-font-gallery-preview">
      {previewFamily ? (
        <FontFamilyPreview kind={row.kind} family={previewFamily} name={name} t={t} />
      ) : <p className="gonavi-settings-inline-meta">{t(entry ? 'app.theme.font_family.gallery.preview_idle' : 'app.theme.font_family.gallery.pending_download')}</p>}
      {preview?.error && <Alert type="error" showIcon message={t(preview.error)} />}
      {activationError && <Alert type="error" showIcon message={t(activationError)} />}
    </div>
    <p className="gonavi-settings-inline-meta">{row.description}</p>
    <p className="gonavi-settings-inline-meta">{row.useCase}</p>
    <p className="gonavi-settings-inline-meta">{row.licenseName}</p>
    <div className="gonavi-font-gallery-actions">
      {!local && !installed && row.remote && <Button type="primary" disabled={busy} onClick={() => { void download(); }}>
        {t('app.theme.font_family.gallery.download')}
      </Button>}
      {(installed || local) && <Button disabled={busy} onClick={() => { void applyFont(); }}>
        {t('app.theme.font_family.gallery.apply')}
      </Button>}
      {installed && !inUse && <Button danger disabled={busy} onClick={() => { void gallery.remove(installed.entry); }}>
        {t('app.theme.font_family.gallery.remove')}
      </Button>}
    </div>
  </>;
}
