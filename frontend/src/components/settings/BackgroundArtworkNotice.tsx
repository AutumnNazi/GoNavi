import type { MouseEvent } from 'react';
import { BrowserOpenURL } from '../../../wailsjs/runtime';
import { useI18n } from '../../i18n/provider';
import type { GalleryEntry } from '../../backgroundGallery/types';

function openLink(event: MouseEvent<HTMLAnchorElement>, url: string) {
  if (!window.runtime) return;
  event.preventDefault(); BrowserOpenURL(url);
}
export default function BackgroundArtworkNotice({ entry }: { entry: GalleryEntry }) {
  const { t } = useI18n();
  return <details className="gonavi-background-artwork-notice">
    <summary>{t('app.theme.background.gallery.license')}</summary>
    <p>{entry.attribution}</p>
    <p>{entry.license.name}</p>
    {entry.license.nonCommercial && <p>{t('app.theme.background.gallery.non_commercial')}</p>}
    <div className="gonavi-background-image-actions">
      <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={event => openLink(event, entry.sourceUrl)}>{t('app.theme.background.gallery.source')}</a>
      <a href={entry.license.url} target="_blank" rel="noopener noreferrer" onClick={event => openLink(event, entry.license.url)}>{t('app.theme.background.gallery.license_link')}</a>
    </div>
    <pre>{entry.license.notice}</pre><pre>{entry.license.text}</pre>
  </details>;
}
