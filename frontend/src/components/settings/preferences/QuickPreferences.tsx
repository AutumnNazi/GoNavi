import { cloneElement, useState, type ReactElement, type HTMLAttributes } from 'react';
import { Button, Popover } from 'antd';
import { useOptionalI18n } from '../../../i18n/provider';
import { t as defaultTranslate } from '../../../i18n';
import { PreferenceControls, type PreferenceControl } from './PreferenceControls';
import { openPreferencePage, preferenceTitleKey, type PreferencePage } from './preferencePages';
import TitlebarActionsPlacementSettings from '../TitlebarActionsPlacementSettings';
import './preferences.css';

export type QuickPreferenceArea = 'table' | 'toolbar';
const pages: Record<QuickPreferenceArea, PreferencePage> = { table: 'editor-settings', toolbar: 'layout-settings' };
const controls: Record<QuickPreferenceArea, PreferenceControl[]> = { table: ['borders', 'density'], toolbar: ['layout'] };
export function QuickPreferencePanel({ area, onNavigate }: { area: QuickPreferenceArea; onNavigate?: () => void }) {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  return <div className="gn-quick-preferences" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <h3>{t(preferenceTitleKey(pages[area]))}</h3>
    <PreferenceControls compact controls={controls[area]} />
    {area === 'toolbar' && <TitlebarActionsPlacementSettings />}
    <Button type="link" onClick={() => { onNavigate?.(); openPreferencePage(pages[area]); }}>{t('settings.quick.all')}</Button>
  </div>;
}
export function QuickPreferences({ area, children, contextMenu = false }: { area: QuickPreferenceArea; children: ReactElement<HTMLAttributes<HTMLElement>>; contextMenu?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = contextMenu ? cloneElement(children, {
    onKeyDown: event => {
      children.props.onKeyDown?.(event);
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); setOpen(true); }
    },
  }) : children;
  return <Popover open={open} onOpenChange={setOpen} trigger={contextMenu ? ['contextMenu'] : ['click']} placement="bottomLeft"
    content={<QuickPreferencePanel area={area} onNavigate={() => setOpen(false)} />}>{trigger}</Popover>;
}
