import { useStore } from '../../../../store';
import type { ReactNode } from 'react';
import type { TitlebarActionsPlacement, TitlebarActionsDisplay } from '../../../../utils/titlebarActionsPlacement';
import { useOptionalI18n } from '../../../../i18n/provider';
import { t as defaultTranslate } from '../../../../i18n';
import TitleBarPrimaryActions from '../../../TitleBarPrimaryActions';
import TitleBarQuickActions from '../../../TitleBarQuickActions';
import { LivePreviewObjectActions } from './LivePreviewObjectActions';
import { TitlebarGraphIcon, TitlebarSqlToolIcon, TitlebarSparkColorIcon } from '../../../titlebar/gonaviTitlebarIcons';
import '../../../titlebar/titleBarActionRow.css';
import '../../../titlebar/titleBarToolBar.css';

type Props = {
  mode: 'classic' | 'navicat';
  placement?: TitlebarActionsPlacement;
  display?: TitlebarActionsDisplay;
  navigation?: ReactNode;
  onNewConnection: () => void;
  onNewQuery: () => void;
  onOpenTable?: () => void;
  onLocalAction: () => void;
};

export function LivePreviewTitleBar({ mode, placement: previewPlacement, display: previewDisplay, navigation, onNewConnection, onNewQuery, onOpenTable, onLocalAction }: Props) {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const activePlacement = useStore(state => state.appearance.titlebarActionsPlacement);
  const activeDisplay = useStore(state => state.appearance.titlebarActionsDisplay);
  const placement = previewPlacement ?? activePlacement;
  const display = previewDisplay ?? activeDisplay;
  const inline = placement === 'titlebar';
  const objectActions = mode === 'navicat' ? <LivePreviewObjectActions onOpenTable={onOpenTable ?? onLocalAction} onLocalAction={onLocalAction} /> : null;
  const tools = <>
    <TitleBarPrimaryActions layoutMode={mode} newConnectionLabel={t('connection.new')} newQueryLabel={t('sidebar.menu.new_query')}
      onNewConnection={onNewConnection} onNewQuery={onNewQuery}
      shortLabels={inline ? {
        newConnection: t('app.titlebar.short_label.new_connection'),
        newQuery: t('app.titlebar.short_label.new_query'),
        connectionGroup: t('app.titlebar.short_label.connection_groups'),
      } : undefined} />
    {!inline && objectActions}
    <TitleBarQuickActions label={t('settings.preview.tools')} actions={[
      { key: 'workflow', label: t('app.tools.group.workflow.title'), shortLabel: inline ? t('app.titlebar.short_label.data_workflow') : undefined,
        icon: <TitlebarGraphIcon />, onClick: onLocalAction },
      { key: 'sql', label: t('sidebar.action.sql_tools'), shortLabel: inline ? t('app.titlebar.short_label.sql_tools') : undefined,
        icon: <TitlebarSqlToolIcon />, onClick: onNewQuery },
      { key: 'ai', label: 'AI', icon: <TitlebarSparkColorIcon />, onClick: onLocalAction },
    ]} />
  </>;
  return <>
    <header className={`gn-v2-titlebar gn-live-chrome${inline && navigation ? ' gn-v2-titlebar-collapsed-docked' : ''}`}>
      <div className="gonavi-titlebar-leading">
        <div className="gn-live-window-controls" aria-hidden="true"><i /><i /><i /></div>
        <strong>GoNavi</strong>
        {inline && <div className="gonavi-titlebar-inline-actions" data-titlebar-actions-placement="titlebar"
          data-titlebar-actions-display={display} role="group" aria-label={t('settings.preview.tools')}>{tools}</div>}
      </div>
      <span className="gn-live-preview-label">{t('settings.preview.interactive')}</span>
      {inline && navigation}
    </header>
    {!inline && <div className="gn-titlebar-toolbar" role="toolbar" aria-label={t('settings.preview.tools')}>{tools}</div>}
    {inline && objectActions && <div className="gn-titlebar-toolbar" role="toolbar" aria-label={t('sidebar.rail.object_actions')}>{objectActions}</div>}
    {!inline && navigation}
  </>;
}
