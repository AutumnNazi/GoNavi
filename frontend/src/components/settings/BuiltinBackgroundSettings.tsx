import { Alert, Button, Switch } from 'antd';
import { useId, useState } from 'react';
import { useBackgroundImageStore } from '../../backgroundImageStore';
import { useI18n } from '../../i18n/provider';
import { galleryErrorKey } from '../../backgroundGallery/errors';
import BackgroundArtworkNotice from './BackgroundArtworkNotice';
import BackgroundGalleryPanel from './BackgroundGalleryPanel';
import './BuiltinBackgroundSettings.css';
interface Props { disabled: boolean; runAction: (action: () => void) => void }

export default function BuiltinBackgroundSettings({ disabled, runAction }: Props) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const enabled = useBackgroundImageStore(state => state.enabled);
  const builtinId = useBackgroundImageStore(state => state.builtinId);
  const image = useBackgroundImageStore(state => state.image);
  const selected = useBackgroundImageStore(state => state.resolvedGallery);
  const error = useBackgroundImageStore(state => state.galleryError);
  const setEnabled = useBackgroundImageStore(state => state.setEnabled);
  return <section className="gonavi-builtin-backgrounds" aria-label={t('app.theme.background.gallery.title')}>
    <div className="gonavi-background-enable">
      <label htmlFor={id}>{t('app.theme.background.enabled')}</label>
      <Switch id={id} checked={enabled} disabled={disabled || (!image && !builtinId)}
        aria-describedby={id + '-hint'} onChange={value => runAction(() => setEnabled(value))} />
    </div>
    <p id={id + '-hint'} className="gonavi-background-image-hint">{t('app.theme.background.enabled_hint')}</p>
    {builtinId && !selected && error && <Alert type="warning" showIcon message={t(error === 'unavailable'
      ? 'app.theme.background.gallery.missing' : galleryErrorKey(error))} />}
    <Button className="gonavi-gallery-toggle" disabled={disabled} aria-expanded={open} aria-controls={id + '-gallery'} onClick={() => setOpen(value => !value)}>
      {t(open ? 'app.theme.background.gallery.close' : 'app.theme.background.gallery.open')}
    </Button>
    {open && <div id={id + '-gallery'}><BackgroundGalleryPanel disabled={disabled} /></div>}
    {!open && selected && <BackgroundArtworkNotice entry={selected.entry} />}
  </section>;
}
