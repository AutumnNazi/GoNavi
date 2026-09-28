import { ClusterOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { useMemo } from 'react';
import { useI18n } from '../../i18n/provider';
import { useStore } from '../../store';
import { useWorkbenchTabs } from '../../hooks/useWorkbenchTabs';
import { buildSessionWorkbenchTab } from '../../utils/sessionWorkbenchTab';
import { isRedisConnection } from '../sessionWorkbench/sessionWorkbenchModel';
import './SessionWorkbenchRailButton.css';

export default function SessionWorkbenchRailButton() {
  const { t } = useI18n();
  const tabs = useWorkbenchTabs();
  const activeTabId = useStore((state) => state.activeTabId);
  const connections = useStore((state) => state.connections);
  const addTab = useStore((state) => state.addTab);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) || null,
    [activeTabId, tabs],
  );
  const activeConnection = useMemo(() => {
    const connection = connections.find((candidate) => candidate.id === activeTab?.connectionId);
    return connection && !isRedisConnection(connection) ? connection : null;
  }, [activeTab?.connectionId, connections]);

  return (
    <Tooltip title={t('session_workbench.rail.tooltip')} placement="right">
      <button
        type="button"
        className="gn-session-workbench-rail-button"
        onClick={() => addTab(buildSessionWorkbenchTab({
          connectionId: activeConnection?.id,
          dbName: activeTab?.dbName,
        }))}
        aria-label={t('session_workbench.rail.aria_label')}
        data-sidebar-session-workbench-action="true"
      >
        <ClusterOutlined aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
