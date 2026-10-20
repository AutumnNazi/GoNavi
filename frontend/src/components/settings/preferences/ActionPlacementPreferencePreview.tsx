import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { useStore } from '../../../store';
import { useOptionalI18n } from '../../../i18n/provider';
import { t as defaultTranslate } from '../../../i18n';
import TitlebarActionsPlacementSettings from '../TitlebarActionsPlacementSettings';
import { SidebarActionsPlacementSettings } from '../SidebarLayoutSettings';
import { PreviewSurface } from './livePreview/PreviewSurface';
import { LivePreviewWorkbench } from './livePreview/LivePreviewWorkbench';
import type { TitlebarActionsPlacement } from '../../../utils/titlebarActionsPlacement';
import './preferencePreviews.css';

const titles = {
  titlebar: 'app.theme.titlebar_actions_placement.title',
  'titlebar-display': 'app.theme.titlebar_actions_placement.display_title',
  sidebar: 'app.theme.sidebar_actions_placement.title',
} as const;
const hints = {
  titlebar: 'settings.preview.titlebar_actions_hint',
  'titlebar-display': 'settings.preview.titlebar_display_hint',
  sidebar: 'settings.preview.sidebar_actions_hint',
} as const;

type Props = {
  area: keyof typeof titles;
  visible?: boolean;
  placementPreview?: { value: TitlebarActionsPlacement; onChange: (value: TitlebarActionsPlacement) => void };
};
export function ActionPlacementPreferencePreview({ area, visible = true, placementPreview }: Props) {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const { uiLayoutMode, titlebarActionsPlacement, titlebarActionsDisplay, sidebarActionsPlacement } = useStore(state => state.appearance);
  const setAppearance = useStore(state => state.setAppearance);
  const [localPlacement, setLocalPlacement] = useState(titlebarActionsPlacement);
  const draftPlacement = placementPreview?.value ?? localPlacement;
  const setDraftPlacement = placementPreview?.onChange ?? setLocalPlacement;
  const [draftDisplay, setDraftDisplay] = useState(titlebarActionsDisplay);
  const [draftSidebar, setDraftSidebar] = useState(sidebarActionsPlacement);
  useEffect(() => setLocalPlacement(titlebarActionsPlacement), [titlebarActionsPlacement]);
  useEffect(() => setDraftDisplay(titlebarActionsDisplay), [titlebarActionsDisplay]);
  useEffect(() => setDraftSidebar(sidebarActionsPlacement), [sidebarActionsPlacement]);
  if (!visible) return null;
  const changes = area === 'titlebar'
    ? { titlebarActionsPlacement: draftPlacement }
    : area === 'titlebar-display' ? { titlebarActionsDisplay: draftDisplay } : { sidebarActionsPlacement: draftSidebar };
  const previewActions = area === 'titlebar-display' ? { ...changes, titlebarActionsPlacement: 'titlebar' as const } : changes;
  const unchanged = area === 'titlebar'
    ? draftPlacement === titlebarActionsPlacement
    : area === 'titlebar-display' ? draftDisplay === titlebarActionsDisplay : draftSidebar === sidebarActionsPlacement;
  const title = t(titles[area]);
  return <section className="gn-preference-section gn-action-placement-preview" aria-label={title}>
    <h3>{title}</h3><p className="gn-action-preview-hint">{t('settings.preview.only')}</p>
    {area === 'sidebar' ? <SidebarActionsPlacementSettings value={draftSidebar} onChange={setDraftSidebar} />
      : <TitlebarActionsPlacementSettings section={area === 'titlebar' ? 'placement' : 'display'}
        value={{ titlebarActionsPlacement: draftPlacement, titlebarActionsDisplay: draftDisplay }} onChange={patch => {
          if (patch.titlebarActionsPlacement) setDraftPlacement(patch.titlebarActionsPlacement);
          if (patch.titlebarActionsDisplay) setDraftDisplay(patch.titlebarActionsDisplay);
        }} />}
    <div className="gn-preference-preview">
      <PreviewSurface mode={uiLayoutMode} height={420} label={t('settings.preview.show_named', { name: title })}>
        <LivePreviewWorkbench mode={uiLayoutMode} actions={previewActions} initialTab="table" />
      </PreviewSurface>
      <div className="gn-preview-footer"><span>{t(hints[area])}</span>
        <Button size="small" disabled={unchanged} onClick={() => setAppearance(changes)}>
          {t(unchanged ? 'settings.preview.current' : 'settings.preview.apply_actions')}
        </Button>
      </div>
    </div>
  </section>;
}
