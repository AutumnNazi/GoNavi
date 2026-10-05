import React from "react";
import { Empty, Spin, Tag } from "antd";
import { useStore } from "../../store";
import { t } from "../../i18n";
import type { TabData } from "../../types";
import "./SessionAssetsWorkbench.css";

/**
 * 智能体会话资产工作台：一种工具一个唯一页签。M2 交付接入状态与资产
 * 占位空态；发现与阅读能力由后续阶段填充，不显示伪造数据。
 */
const SessionAssetsWorkbench: React.FC<{
  tab: TabData;
  isActive?: boolean;
}> = ({ tab }) => {
  const agentIntegrations = useStore((state) => state.agentIntegrations);
  const loading = useStore((state) => state.agentIntegrationsLoading);
  const refreshAgentIntegrations = useStore((state) => state.refreshAgentIntegrations);

  const integrationId = tab.agentIntegrationId || "";
  const integration = agentIntegrations.find((item) => item.integrationId === integrationId) || null;

  React.useEffect(() => {
    if (!integration && !loading) {
      void refreshAgentIntegrations();
    }
  }, [integration, loading, refreshAgentIntegrations]);

  const displayName = integration?.displayName || "Codex";

  return (
    <div className="session-assets-workbench" data-session-assets-workbench="true">
      <header className="session-assets-workbench-header">
        <h2 className="session-assets-workbench-title">
          {t("session_assets.workbench.title", { name: displayName })}
        </h2>
        {integration ? (
          <Tag
            color={integration.enabled ? "green" : "default"}
            data-session-assets-enabled-state={integration.enabled ? "enabled" : "disabled"}
          >
            {integration.enabled
              ? t("session_assets.workbench.state.protecting")
              : t("session_assets.workbench.state.disabled")}
          </Tag>
        ) : null}
      </header>
      <div className="session-assets-workbench-hint">
        {t("session_assets.workbench.protection_hint")}
      </div>
      <div className="session-assets-workbench-body">
        {!integration && loading ? (
          <Spin />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("session_assets.workbench.assets_empty")}
          />
        )}
      </div>
    </div>
  );
};

export default SessionAssetsWorkbench;
