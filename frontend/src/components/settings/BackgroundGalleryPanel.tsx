import { Alert, Button, Spin } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n/provider';
import { useBackgroundImageStore } from '../../backgroundImageStore';
import { galleryEntryKey, useGalleryPanel } from '../../backgroundGallery/useGalleryPanel';
import { galleryErrorKey } from '../../backgroundGallery/errors';
import BackgroundGalleryCard from './BackgroundGalleryCard';

export default function BackgroundGalleryPanel({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const gallery = useGalleryPanel();
  const selectedId = useBackgroundImageStore(state => state.builtinId);
  const selectedVersion = useBackgroundImageStore(state => state.builtinVersion || state.resolvedGallery?.entry.version);
  return <div className="gonavi-gallery-panel">
    <div className="gonavi-gallery-toolbar">
      <h4>{t('app.theme.background.gallery.title')}</h4>
      <Button icon={<ReloadOutlined aria-hidden="true" />} disabled={disabled || gallery.loading || Boolean(gallery.pending)} onClick={() => { void gallery.refresh(); }}>
        {t('app.theme.background.gallery.refresh')}
      </Button>
    </div>
    <p className="gonavi-background-image-hint">{t('app.theme.background.gallery.description')}</p>
    {gallery.loading && <div role="status"><Spin size="small" /> {t('app.theme.background.gallery.loading')}</div>}
    {gallery.error && <Alert type="error" showIcon role="alert" message={t(gallery.error)} />}
    {gallery.state.stale && <Alert type="warning" showIcon message={t('app.theme.background.gallery.stale')} />}
    {!gallery.state.stale && gallery.state.warningCode && <Alert type="warning" showIcon message={t(galleryErrorKey(gallery.state.warningCode))} />}
    {!gallery.loading && gallery.entries.length === 0 && <p>{t('app.theme.background.gallery.empty')}</p>}
    <div className="gonavi-builtin-background-options">
      {gallery.entries.map(entry => <BackgroundGalleryCard key={galleryEntryKey(entry)} entry={entry}
        showVersion={gallery.entries.some(other => other.id === entry.id && other.version !== entry.version)}
        downloaded={gallery.state.installed.some(value => value.entry.id === entry.id && value.entry.version === entry.version)}
        selected={selectedId === entry.id && (!selectedVersion || selectedVersion === entry.version)} pending={gallery.pending === galleryEntryKey(entry)} failed={gallery.failed === galleryEntryKey(entry)}
        disabled={disabled} progress={gallery.pending === galleryEntryKey(entry) ? gallery.progress : null}
        onSelect={() => { void gallery.select(entry); }} onCancel={gallery.cancel} onRemove={() => { void gallery.remove(entry); }} />)}
    </div>
  </div>;
}
