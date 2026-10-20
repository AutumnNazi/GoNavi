import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { useStore } from '../../../store';
import { useOptionalI18n } from '../../../i18n/provider';
import { t as defaultTranslate } from '../../../i18n';
import { PreviewSurface } from './livePreview/PreviewSurface';
import { LivePreviewWorkbench } from './livePreview/LivePreviewWorkbench';
import './preferencePreviews.css';

export function LayoutPreferencePreview() {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const active = useStore(state => state.appearance.uiLayoutMode);
  const reducedMotion = useStore(state => state.appearance.reduceMotion);
  const setAppearance = useStore(state => state.setAppearance);
  const [mode, setMode] = useState(active);
  useEffect(() => setMode(active), [active]);
  return <section className="gn-preference-preview" aria-label={t('settings.preview.layout')} data-reduced-motion={reducedMotion}>
    <div className="gn-preview-heading"><div><h4>{t('settings.preview.layout')}</h4><p>{t('settings.preview.only')}</p></div>
      <div className="gn-preview-choices" role="group" aria-label={t('settings.preview.layout')}>
        {(['classic', 'navicat'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{t(`settings.preview.${value}`)}</button>)}
      </div>
    </div>
    <PreviewSurface mode={mode} label={t('settings.preview.interactive')}>
      <LivePreviewWorkbench mode={mode} />
    </PreviewSurface>
    <div className="gn-preview-footer"><span>{t(`settings.preview.${mode}_description`)}</span>
      <Button size="small" disabled={mode === active} onClick={() => setAppearance({ uiLayoutMode: mode })}>{t(mode === active ? 'settings.preview.current' : 'settings.preview.apply_layout')}</Button>
    </div>
  </section>;
}
