import { useEffect, useMemo, useRef, useState } from 'react';
import { FontFamilySelect } from './FontFamilySelect';
import { FontGalleryPanel } from '../../fontGallery/FontGalleryPanel';
import { cssStack, mergeDownloadedFontOptions } from '../../fontGallery/options';
import { getFontGalleryAdapter } from '../../fontGallery/adapter';
import { useDownloadedFontSelection } from '../../fontGallery/useDownloadedFontSelection';
import { Alert } from 'antd';
import type { FontInstalled } from '../../fontGallery/types';
import type { UseAppThemeSettingsRenderInput } from '../hooks/useAppThemeSettingsRender';

interface Props {
  t: UseAppThemeSettingsRenderInput['t'];
  appearance: UseAppThemeSettingsRenderInput['appearance'];
  setAppearance: UseAppThemeSettingsRenderInput['setAppearance'];
  isFontFamiliesLoading: UseAppThemeSettingsRenderInput['isFontFamiliesLoading'];
  uiFontOptions: UseAppThemeSettingsRenderInput['uiFontOptions'];
  monoFontOptions: UseAppThemeSettingsRenderInput['monoFontOptions'];
  fontFamiliesLoadError: UseAppThemeSettingsRenderInput['fontFamiliesLoadError'];
  installedFontFamilies: UseAppThemeSettingsRenderInput['installedFontFamilies'];
  linuxCJKFontInstallHint: UseAppThemeSettingsRenderInput['linuxCJKFontInstallHint'];
  hasLoadedInstalledFontsRef: UseAppThemeSettingsRenderInput['hasLoadedInstalledFontsRef'];
  darkMode: UseAppThemeSettingsRenderInput['darkMode'];
}

export function FontFamilySettingsBlock({
  t, appearance, setAppearance, isFontFamiliesLoading, uiFontOptions, monoFontOptions,
  fontFamiliesLoadError, installedFontFamilies, linuxCJKFontInstallHint, hasLoadedInstalledFontsRef, darkMode,
}: Props) {
  // 画廊默认展开：入口不再折叠在按钮后面，用户可随时收起。
  const [browseOpen, setBrowseOpen] = useState(true);
  const [downloaded, setDownloaded] = useState<FontInstalled[]>([]);
  const galleryRef = useRef<HTMLDivElement | null>(null);
  // 入口跟随两个字体下拉：从下拉底部打开时滚动到画廊，避免打开后仍然看不见。
  const browseGallery = () => {
    setBrowseOpen(true);
    requestAnimationFrame(() => galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  const browseProps = { browseLabel: t('app.theme.font_family.gallery.browse'), onBrowse: browseGallery };
  const selection = useDownloadedFontSelection(downloaded, (kind, value) => setAppearance(kind === 'ui'
    ? { customUIFontFamily: value } : { customMonoFontFamily: value }));
  useEffect(() => {
    let cancelled = false;
    void getFontGalleryAdapter().status().then(state => {
      if (!cancelled) setDownloaded(state.installed);
    }).catch(() => undefined);
    const onChange = () => {
      void getFontGalleryAdapter().status().then(state => {
        if (!cancelled) setDownloaded(state.installed);
      }).catch(() => undefined);
    };
    window.addEventListener('gonavi:font-gallery-changed', onChange);
    return () => { cancelled = true; window.removeEventListener('gonavi:font-gallery-changed', onChange); };
  }, []);
  const uiOptions = useMemo(() => mergeDownloadedFontOptions(uiFontOptions, downloaded, 'ui', appearance.customUIFontFamily), [uiFontOptions, downloaded, appearance.customUIFontFamily]);
  const monoOptions = useMemo(() => mergeDownloadedFontOptions(monoFontOptions, downloaded, 'mono', appearance.customMonoFontFamily), [monoFontOptions, downloaded, appearance.customMonoFontFamily]);
  return (
    <>
      <div style={{ padding: '8px 0' }}>
        <FontFamilySelect
          kind="ui"
          value={appearance.customUIFontFamily}
          options={uiOptions}
          loading={isFontFamiliesLoading || selection.loading}
          onChange={(value) => { void selection.selectFont('ui', value); }}
          t={t}
          {...browseProps}
        />
        <div className="gonavi-settings-inline-meta">
          {fontFamiliesLoadError
            ? t('app.theme.font_family.load_failed_fallback', { error: fontFamiliesLoadError })
            : (installedFontFamilies.length > 0
              ? t('app.theme.font_family.loaded_ui_hint', { count: installedFontFamilies.length })
              : t('app.theme.font_family.loading_ui_hint'))}
        </div>
        {linuxCJKFontInstallHint && hasLoadedInstalledFontsRef.current && !isFontFamiliesLoading && !fontFamiliesLoadError ? (
          <div className="gonavi-settings-alert" style={{ borderColor: darkMode ? 'rgba(250,204,21,0.28)' : 'rgba(217,119,6,0.22)', background: darkMode ? 'rgba(250,204,21,0.08)' : 'rgba(251,191,36,0.12)', color: darkMode ? 'rgba(254,249,195,0.92)' : '#92400e' }}>
            {t('app.theme.font_family.linux_cjk_install_prefix')}
            <span style={{ fontFamily: 'var(--gn-font-mono)', marginLeft: 6 }}>{linuxCJKFontInstallHint}</span>
            {t('app.theme.font_family.linux_cjk_install_suffix')}
          </div>
        ) : null}
      </div>
      <div style={{ padding: '8px 0', borderTop: '1px solid var(--gn-settings-line)' }}>
        <FontFamilySelect
          kind="mono"
          value={appearance.customMonoFontFamily}
          options={monoOptions}
          loading={isFontFamiliesLoading || selection.loading}
          onChange={(value) => { void selection.selectFont('mono', value); }}
          t={t}
          {...browseProps}
        />
        <div className="gonavi-settings-inline-meta">
          {fontFamiliesLoadError
            ? t('app.theme.font_family.mono_fallback_hint')
            : t('app.theme.font_family.mono_hint')}
        </div>
      </div>
      {selection.error && <Alert type="error" showIcon message={t(selection.error)} />}
      <div ref={galleryRef}>
        <FontGalleryPanel
          open={browseOpen}
          onToggle={() => setBrowseOpen(value => !value)}
          installedFontFamilies={installedFontFamilies}
          activeUi={appearance.customUIFontFamily}
          activeMono={appearance.customMonoFontFamily}
          onEnable={(kind, family) => setAppearance(kind === 'ui'
            ? { customUIFontFamily: cssStack(family, 'ui') }
            : { customMonoFontFamily: cssStack(family, 'mono') })}
        />
      </div>
    </>
  );
}
