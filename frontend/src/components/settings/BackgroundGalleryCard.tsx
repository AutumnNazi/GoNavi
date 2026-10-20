import { Button, Progress, Tag } from 'antd';
import { DownloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n/provider';
import type { GalleryEntry, GalleryProgress } from '../../backgroundGallery/types';
import { useGalleryThumbnail } from '../../backgroundGallery/useGalleryThumbnail';
import { galleryEntryName } from '../../utils/resolvedBackground';
import BackgroundArtworkNotice from './BackgroundArtworkNotice';
interface Props {
  showVersion?: boolean;
  entry: GalleryEntry; downloaded: boolean; selected: boolean; pending: boolean; failed: boolean;
  disabled: boolean; progress: GalleryProgress | null;
  onSelect: () => void; onCancel: () => void; onRemove: () => void;
}
export default function BackgroundGalleryCard(props: Props) {
  const { entry, downloaded, selected, pending, failed, disabled, progress, onSelect, onCancel, onRemove } = props;
  const { t, language } = useI18n();
  const thumbnail = useGalleryThumbnail(entry);
  const name = galleryEntryName(entry, language);
  const percent = progress && progress.total > 0 ? Math.min(100, Math.floor(progress.downloaded / progress.total * 100)) : 0;
  return <article className="gonavi-gallery-card" aria-busy={pending}>
    <div className="gonavi-gallery-thumbnail" ref={thumbnail.ref} aria-hidden="true">
      {thumbnail.url && <img src={thumbnail.url} alt="" loading="lazy" />}
    </div>
    <div className="gonavi-gallery-card-heading"><strong>{name}</strong>
      <Tag>{t(selected ? 'app.theme.background.gallery.selected' : downloaded ? 'app.theme.background.gallery.downloaded' : 'app.theme.background.gallery.not_downloaded')}</Tag>
    </div>
    {props.showVersion && <span className="gonavi-background-image-hint">{entry.version}</span>}
    <span className="gonavi-background-image-hint">{t('app.theme.background.gallery.size', { size: (entry.image.sizeBytes / 1024 / 1024).toFixed(2) })}</span>
    {pending ? <div role="status" aria-live="polite">
      <span>{t('app.theme.background.gallery.downloading')}</span>
      <Progress percent={percent} size="small" />
      <Button className="gonavi-gallery-cancel" onClick={onCancel}>{t('app.theme.background.gallery.cancel')}</Button>
    </div> : <div className="gonavi-gallery-card-actions">
      <Button className="gonavi-builtin-background-option" icon={<DownloadOutlined aria-hidden="true" />} disabled={disabled}
        aria-pressed={selected} onClick={onSelect}>{t(failed ? 'app.theme.background.gallery.retry' : downloaded ? 'app.theme.background.gallery.use' : 'app.theme.background.gallery.download')}</Button>
      {downloaded && <Button className="gonavi-gallery-remove" icon={<DeleteOutlined aria-hidden="true" />} disabled={disabled || selected}
        onClick={onRemove} aria-label={t('app.theme.background.gallery.remove')} title={t('app.theme.background.gallery.remove')} />}
    </div>}
    <BackgroundArtworkNotice entry={entry} />
  </article>;
}
