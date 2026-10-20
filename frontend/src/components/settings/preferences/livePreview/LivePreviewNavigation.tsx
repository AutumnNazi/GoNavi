import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useOptionalI18n } from '../../../../i18n/provider';
import { t as defaultTranslate } from '../../../../i18n';
import { DockedSidebarActionsHost, V2ExplorerSearchAction, V2ExplorerToolbarActions, V2RailExplorerActions } from '../../../sidebar/SidebarExplorerToolbar';

type Props = {
  placement: 'rail' | 'titlebar' | 'below-toolbar';
  collapsed: boolean;
  onToggle: () => void;
  onSearch: () => void;
  onLocate: () => void;
  onScrollToTop: () => void;
  onConnectionActions: () => void;
};
export function LivePreviewNavigation({ placement, collapsed, onToggle, onSearch, onLocate, onScrollToTop, onConnectionActions }: Props) {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const label = t('sidebar.rail.system_actions');
  const toggleLabel = t(collapsed ? 'app.sidebar.expand' : 'app.sidebar.collapse');
  const search = { label: t('sidebar.command_search.label'), onClick: onSearch };
  const toolbar = {
    labels: {
      objectActions: t('sidebar.rail.object_actions'),
      locateCurrentTable: t('sidebar.action.locate_current_table'),
      locateCurrentTableUnavailable: t('sidebar.message.locate_current_table_unavailable'),
      scrollToTop: t('sidebar.action.scroll_to_top'),
      connectionActions: t('sidebar.active_connection.actions'),
    },
    canLocateActiveTab: true, hasActiveConnection: true,
    onLocateCurrentTable: onLocate, onScrollToTop, onOpenConnectionActions: onConnectionActions,
  };
  if (placement === 'rail') {
    const toggle = { label: toggleLabel, onClick: onToggle };
    return <div className="gn-v2-sidebar-redesign gn-live-navigation-rail"><div className="gn-v2-connection-rail">
      <V2RailExplorerActions label={label} searchAction={search} toolbar={toolbar}
        collapseAction={collapsed ? undefined : toggle} expandAction={collapsed ? toggle : undefined} />
    </div></div>;
  }
  return <>
    <DockedSidebarActionsHost label={label} placement={placement} collapsed={collapsed}
      slotRef={setSlot} toggleLabel={toggleLabel} onToggle={onToggle} />
    {slot && createPortal(<><V2ExplorerSearchAction {...search} /><V2ExplorerToolbarActions {...toolbar} /></>, slot)}
  </>;
}
