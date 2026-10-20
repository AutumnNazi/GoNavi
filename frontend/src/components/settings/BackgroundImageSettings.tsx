import { DeleteOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Slider } from 'antd';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { useResolvedBackground } from '../../backgroundGallery/useResolvedBackground';
import BuiltinBackgroundSettings from './BuiltinBackgroundSettings';
import { useBackgroundImageStore } from '../../backgroundImageStore';
import { useI18n } from '../../i18n/provider';
import type { BackgroundImageError } from '../../utils/backgroundImage';
import BackgroundImagePositionSettings from './BackgroundImagePositionSettings';
import './BackgroundImageSettings.css';

const ERROR_KEYS: Record<BackgroundImageError['code'], string> = {
  'invalid-type': 'app.theme.background.error.invalid_type',
  'too-large': 'app.theme.background.error.too_large',
  'invalid-image': 'app.theme.background.error.invalid_image',
  'storage-failed': 'app.theme.background.error.storage_failed',
};

function resolveErrorKey(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_KEYS, code)) {
      return ERROR_KEYS[code as BackgroundImageError['code']];
    }
  }
  return 'app.theme.background.error.operation_failed';
}

function useBackgroundImageActions() {
  const importImage = useBackgroundImageStore((state) => state.importImage);
  const clearImage = useBackgroundImageStore((state) => state.clearImage);
  const reset = useBackgroundImageStore((state) => state.reset);
  const setOpacity = useBackgroundImageStore((state) => state.setOpacity);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const requestFile = () => {
    if (busyRef.current || !inputRef.current) return;
    inputRef.current.value = '';
    inputRef.current.click();
  };
  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrorKey(null);
    try {
      await importImage(file);
    } catch (error) {
      setErrorKey(resolveErrorKey(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const runAction = (action: () => void) => {
    if (busyRef.current) return;
    setErrorKey(null);
    try {
      action();
    } catch (error) {
      setErrorKey(resolveErrorKey(error));
    }
  };
  return {
    inputRef, busy, errorKey, requestFile, handleFileChange, runAction,
    remove: () => runAction(clearImage),
    changeOpacity: (value: number) => runAction(() => setOpacity(value)),
    reset: () => runAction(reset),
    reportError: (error: unknown) => setErrorKey(resolveErrorKey(error)),
  };
}

export default function BackgroundImageSettings() {
  const { t, language } = useI18n();
  const builtinId = useBackgroundImageStore((state) => state.builtinId);
  const image = useResolvedBackground(language);
  const opacity = useBackgroundImageStore((state) => state.opacity);
  const actions = useBackgroundImageActions();
  const intensityId = useId();
  const hintId = useId();
  return (
    <div className="gonavi-background-image-settings" aria-busy={actions.busy}>
      <BuiltinBackgroundSettings disabled={actions.busy} runAction={actions.runAction} />
      <p id={hintId} className="gonavi-background-image-hint">
        {t('app.theme.background.description')}
      </p>
      <input
        ref={actions.inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        hidden
        disabled={actions.busy}
        aria-label={t('app.theme.background.upload')}
        onChange={(event) => { void actions.handleFileChange(event); }}
      />
      {image ? (
        <BackgroundImagePositionSettings image={image} disabled={actions.busy} onError={actions.reportError} />
      ) : <p className="gonavi-background-image-hint">{t('app.theme.background.empty')}</p>}
      <div className="gonavi-background-image-actions">
        <Button
          icon={<UploadOutlined aria-hidden="true" />}
          loading={actions.busy}
          disabled={actions.busy}
          aria-describedby={hintId}
          onClick={actions.requestFile}
        >
          {t(actions.busy ? 'app.theme.background.busy' : image
            ? 'app.theme.background.replace' : 'app.theme.background.upload')}
        </Button>
        {(image || builtinId) && (
          <Button icon={<DeleteOutlined aria-hidden="true" />} disabled={actions.busy} onClick={actions.remove}>
            {t('app.theme.background.remove')}
          </Button>
        )}
        <Button
          icon={<ReloadOutlined aria-hidden="true" />}
          disabled={actions.busy || (!image && !builtinId && opacity === 15)}
          onClick={actions.reset}
        >
          {t('app.theme.background.reset')}
        </Button>
      </div>
      <div className="gonavi-background-image-intensity">
        <label htmlFor={intensityId}>{t('app.theme.background.intensity')}</label>
        <Slider
          id={intensityId}
          min={5}
          max={30}
          step={1}
          value={opacity}
          disabled={actions.busy}
          ariaLabelForHandle={t('app.theme.background.intensity')}
          ariaValueTextFormatterForHandle={(value) => t('app.theme.background.percent', { value })}
          tooltip={{ formatter: (value) => t('app.theme.background.percent', { value }) }}
          onChange={actions.changeOpacity}
        />
        <output htmlFor={intensityId}>{t('app.theme.background.percent', { value: opacity })}</output>
      </div>
      {actions.errorKey && <Alert type="error" showIcon role="alert" message={t(actions.errorKey)} />}
    </div>
  );
}
