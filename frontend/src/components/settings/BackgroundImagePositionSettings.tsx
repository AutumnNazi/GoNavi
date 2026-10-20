import { AimOutlined } from '@ant-design/icons';
import { Button, Slider } from 'antd';
import { useId } from 'react';
import { useI18n } from '../../i18n/provider';
import type { ResolvedBackground } from '../../utils/resolvedBackground';
import { useBackgroundImageDrag } from './useBackgroundImageDrag';
import { useBackgroundImagePosition, useBackgroundViewportRatio } from './useBackgroundImagePosition';
import './BackgroundImagePositionSettings.css';

interface Props {
  image: Pick<ResolvedBackground, 'dataUrl' | 'name'> & Partial<ResolvedBackground>;
  disabled: boolean;
  onError: (error: unknown) => void;
}

export default function BackgroundImagePositionSettings({ image, disabled, onError }: Props) {
  const { t } = useI18n();
  const id = useId();
  const ratio = useBackgroundViewportRatio();
  const name = image.nameKey ? t(image.nameKey) : image.name;
  const { position, preview, commit } = useBackgroundImagePosition(onError);
  const onPointerDown = useBackgroundImageDrag({
    disabled, resetKey: image, position, onMove: preview, onFinish: commit,
  });
  const percent = (value: number | undefined) => t('app.theme.background.percent', { value });
  return (
    <div className="gonavi-background-position" onBlur={commit}>
      <div
        className="gonavi-background-position-preview"
        style={{ aspectRatio: ratio }}
        onPointerDown={onPointerDown}
        aria-disabled={disabled}
        aria-describedby={`${id}-hint`}
      >
        <img
          src={image.dataUrl}
          alt={t('app.theme.background.preview', { name })}
          draggable={false}
          style={{ objectFit: image.fit ?? 'cover', transform: `translate(${position.positionX}%, ${position.positionY}%)` }}
        />
      </div>
      <span className="gonavi-background-image-name" title={name}>{name}</span>
      <p id={`${id}-hint`} className="gonavi-background-image-hint">
        {t('app.theme.background.position.hint')}
      </p>
      {(['positionX', 'positionY'] as const).map((axis) => {
        const label = t(axis === 'positionX'
          ? 'app.theme.background.position.horizontal' : 'app.theme.background.position.vertical');
        return (
          <div className="gonavi-background-position-axis" key={axis}>
            <label htmlFor={`${id}-${axis}`}>{label}</label>
            <Slider
              id={`${id}-${axis}`}
              min={-100}
              max={100}
              step={0.1}
              value={position[axis]}
              disabled={disabled}
              ariaLabelForHandle={label}
              ariaValueTextFormatterForHandle={percent}
              tooltip={{ formatter: percent }}
              onChange={(value) => {
                if (disabled) return;
                preview(axis === 'positionX' ? value : position.positionX,
                  axis === 'positionY' ? value : position.positionY);
              }}
              onChangeComplete={commit}
            />
            <output htmlFor={`${id}-${axis}`}>{percent(position[axis])}</output>
          </div>
        );
      })}
      <Button
        className="gonavi-background-position-center"
        icon={<AimOutlined aria-hidden="true" />}
        disabled={disabled || (position.positionX === 0 && position.positionY === 0)}
        onClick={() => { if (!disabled) { preview(0, 0); commit(); } }}
      >
        {t('app.theme.background.position.center')}
      </Button>
    </div>
  );
}
