import { FavoriteSettings } from './FavoriteSettings';
import type { ReactNode } from 'react';
import { useOptionalI18n } from '../../../i18n/provider';
import { t as defaultTranslate } from '../../../i18n';
import { SidebarSearchModeSettings } from '../SidebarLayoutSettings';
import { ActionPlacementPreferencePreview } from './ActionPlacementPreferencePreview';
import { TitlebarPreferencePreviews } from './TitlebarPreferencePreviews';
import { PreferenceControls } from './PreferenceControls';
import { preferenceDescriptionKey, preferenceTitleKey, type PreferencePage as Page } from './preferencePages';
import './preferences.css';

type Props = { page: Page; renderTheme: (options: { hideSectionTabs: boolean; section?: 'theme' | 'appearance' | 'workspace'; page?: Page }) => ReactNode; metadata: () => ReactNode; objects: () => ReactNode };
export function PreferencePage({ page, renderTheme, metadata, objects }: Props) {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const section = (key: string, children: ReactNode) => <section className="gn-preference-section"><h3>{t(key)}</h3>{children}</section>;
  if (page === 'tabs-settings' || page === 'editor-settings' || page === 'fonts-settings' || page === 'colors-settings') {
    return renderTheme({ hideSectionTabs: true, section: page === 'colors-settings' ? 'theme' : page === 'fonts-settings' ? 'appearance' : 'workspace', page });
  }
  return <div className="gn-preference-page" data-settings-page={page}>
    <header><h2>{t(preferenceTitleKey(page))}</h2><p>{t(preferenceDescriptionKey(page))}</p></header>
    {page === 'common-settings' && <FavoriteSettings />}
    {page === 'layout-settings' && <>
      <PreferenceControls controls={['layout']} />
      <TitlebarPreferencePreviews />
      <ActionPlacementPreferencePreview area="sidebar" />
    </>}
    {page === 'sidebar-settings' && <>
      <PreferenceControls controls={['collapse', 'singleDatabase', 'doubleClick']} />
      {section('app.theme.ui_version.sidebar_search.title', <SidebarSearchModeSettings />)}
      {section('app.settings.sidebar_metadata.title', metadata())}
      {section('app.settings.sidebar_objects.title', objects())}
    </>}
  </div>;
}
