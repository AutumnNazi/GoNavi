import React from "react";
import { Alert, Button, Input, Space, Spin } from "antd";
import {
  ApiOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  ReloadOutlined,
} from "@ant-design/icons";
import { SessionAssetsDetect, SessionAssetsDisable, SessionAssetsEnable } from "../../../wailsjs/go/app/App";
import { t } from "../../i18n";
import { useStore } from "../../store";
import { buildAgentAssetsWorkbenchTab } from "../../utils/agentAssetsTab";
import type { AgentDetectionView } from "../../utils/agentConnectionTypes";
import "./AgentSetupPanel.css";

interface AgentSetupPanelProps {
  /** 智能体类型键（首版仅 codex）。 */
  kind: string;
  /** 启用流程结束后关闭承载弹窗。 */
  onClose: () => void;
}

type DetectionView = AgentDetectionView;

const STATUS_ICON_MAP: Record<string, React.ReactNode> = {
  ready: <CheckCircleFilled className="gn-agent-setup-status-icon ok" />,
  enabled: <CheckCircleFilled className="gn-agent-setup-status-icon ok" />,
  disabled: <ExclamationCircleFilled className="gn-agent-setup-status-icon warn" />,
  ready_to_enable: <CheckCircleFilled className="gn-agent-setup-status-icon ok" />,
  not_installed: <CloseCircleFilled className="gn-agent-setup-status-icon bad" />,
  not_initialized: <ExclamationCircleFilled className="gn-agent-setup-status-icon warn" />,
  data_unreadable: <CloseCircleFilled className="gn-agent-setup-status-icon bad" />,
  library_locked: <ExclamationCircleFilled className="gn-agent-setup-status-icon warn" />,
};

const resolveStatusKey = (view: DetectionView): string =>
  `session_assets.detect.status.${view.integrationStatus || view.detectionStatus}`;

const toErrorMessage = (result: { message?: string } | null | undefined): string =>
  result?.message || t("session_assets.error.generic");

/**
 * 智能体检测/启用页：替代数据库连接表单。检测不发送测试消息、不遍历
 * 会话正文；未通过时支持手动定位数据目录后重新检测（S-05/AC-13）。
 */
const AgentSetupPanel: React.FC<AgentSetupPanelProps> = ({ kind, onClose }) => {
  const [view, setView] = React.useState<DetectionView | null>(null);
  const [detecting, setDetecting] = React.useState(false);
  const [enabling, setEnabling] = React.useState(false);
  const [disabling, setDisabling] = React.useState(false);
  const [manualDataDir, setManualDataDir] = React.useState("");
  const [errorText, setErrorText] = React.useState("");
  const refreshAgentIntegrations = useStore((state) => state.refreshAgentIntegrations);
  const addTab = useStore((state) => state.addTab);

  const runDetect = React.useCallback(
    async (dataDirOverride?: string) => {
      setDetecting(true);
      setErrorText("");
      try {
        const result = await SessionAssetsDetect({ kind, commandPath: "", dataDir: dataDirOverride || "" });
        if (result?.success) {
          setView((result.data as DetectionView) ?? null);
          if (dataDirOverride) setManualDataDir(dataDirOverride);
        } else {
          setErrorText(toErrorMessage(result));
        }
      } catch (err) {
        setErrorText(String(err));
      } finally {
        setDetecting(false);
      }
    },
    [kind],
  );

  React.useEffect(() => {
    void runDetect();
  }, [runDetect]);

  const openManagement = React.useCallback(
    (integration: DetectionView) => {
      addTab(buildAgentAssetsWorkbenchTab({
        integrationId: integration.integrationId,
        displayName: "ChatGPT",
      }));
      void refreshAgentIntegrations();
      onClose();
    },
    [addTab, onClose, refreshAgentIntegrations],
  );

  const handleDisable = React.useCallback(async () => {
    setDisabling(true);
    setErrorText("");
    try {
      const result = await SessionAssetsDisable(kind);
      if (result?.success) {
        const refreshed = await SessionAssetsDetect({ kind, commandPath: "", dataDir: view?.dataDir || "" });
        if (refreshed?.success) setView(refreshed.data as DetectionView);
        void refreshAgentIntegrations();
      } else {
        setErrorText(toErrorMessage(result));
      }
    } catch (err) {
      setErrorText(String(err));
    } finally {
      setDisabling(false);
    }
  }, [kind, view]);

  const handleEnable = React.useCallback(async () => {
    setEnabling(true);
    setErrorText("");
    try {
      const result = await SessionAssetsEnable({
        kind,
        commandPath: "",
        dataDir: manualDataDir,
        materialsRoot: "",
      });
      const nextView = (result?.data as DetectionView) ?? null;
      if (result?.success && nextView) {
        setView(nextView);
        openManagement(nextView);
        return;
      }
      if (nextView) setView(nextView);
      setErrorText(toErrorMessage(result));
    } catch (err) {
      setErrorText(String(err));
    } finally {
      setEnabling(false);
    }
  }, [kind, manualDataDir, onClose, openManagement]);

  const integrationStatus = view?.integrationStatus || view?.detectionStatus || "";
  const detectionRows: Array<{ label: string; value: string }> = [];
  if (view) {
    if (view.commandPath) detectionRows.push({ label: t("session_assets.detect.command"), value: view.commandPath });
    if (view.version) detectionRows.push({ label: t("session_assets.detect.version"), value: view.version });
    if (view.dataDir) detectionRows.push({ label: t("session_assets.detect.data_dir"), value: view.dataDir });
    if (view.materialsRoot) detectionRows.push({ label: t("session_assets.detect.materials_root"), value: view.materialsRoot });
  }

  return (
    <div className="gn-agent-setup" data-agent-setup-panel="true">
      <div className="gn-agent-setup-head">
        <span className="gn-agent-setup-ico" aria-hidden="true">
          <ApiOutlined />
        </span>
        <div>
          <div className="gn-agent-setup-title">ChatGPT</div>
          <div className="gn-agent-setup-subtitle">{t("session_assets.detect.subtitle")}</div>
        </div>
      </div>

      {detecting && !view ? (
        <div className="gn-agent-setup-loading">
          <Spin />
        </div>
      ) : null}

      {view ? (
        <>
          <Alert
            type={
              integrationStatus === "enabled" || integrationStatus === "ready_to_enable" || integrationStatus === "ready"
                ? "success"
                : integrationStatus === "disabled" || integrationStatus === "not_initialized" || integrationStatus === "library_locked"
                  ? "warning"
                  : "error"
            }
            showIcon
            icon={STATUS_ICON_MAP[integrationStatus] ?? undefined}
            message={t(resolveStatusKey(view))}
            className="gn-agent-setup-status"
          />
          <dl className="gn-agent-setup-facts">
            {detectionRows.map((row) => (
              <div key={row.label} className="gn-agent-setup-fact">
                <dt>{row.label}</dt>
                <dd title={row.value}>{row.value}</dd>
              </div>
            ))}
          </dl>

          {view.detectionStatus !== "ready" ? (
            <div className="gn-agent-setup-manual">
              <div className="gn-agent-setup-manual-label">
                {t("session_assets.detect.manual_locate")}
              </div>
              <Space.Compact className="gn-agent-setup-manual-row">
                <Input
                  value={manualDataDir}
                  onChange={(event) => setManualDataDir(event.target.value)}
                  placeholder={t("session_assets.detect.manual_locate_hint")}
                  aria-label={t("session_assets.detect.manual_locate_hint")}
                />
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => void runDetect(manualDataDir)}
                  loading={detecting}
                >
                  {t("session_assets.detect.recheck")}
                </Button>
              </Space.Compact>
              {view.detectionStatus === "not_installed" ? (
                <div className="gn-agent-setup-hint">{t("session_assets.detect.condition_hint")}</div>
              ) : null}
            </div>
          ) : null}

          {errorText ? (
            <Alert type="error" showIcon message={errorText} className="gn-agent-setup-status" />
          ) : null}

          <div className="gn-agent-setup-actions">
            {integrationStatus === "enabled" ? (
              <>
                <Button type="primary" onClick={() => openManagement(view)}>
                  {t("session_assets.action.open_management")}
                </Button>
                <Button
                  danger
                  loading={disabling}
                  onClick={() => void handleDisable()}
                >
                  {t("session_assets.action.disable")}
                </Button>
                <Button onClick={onClose}>{t("common.action.close")}</Button>
              </>
            ) : (
              <>
                <Button
                  type="primary"
                  loading={enabling}
                  disabled={view.detectionStatus !== "ready"}
                  onClick={() => void handleEnable()}
                >
                  {integrationStatus === "disabled"
                    ? t("session_assets.action.re_enable")
                    : t("session_assets.action.enable", { name: "ChatGPT" })}
                </Button>
                <Button onClick={onClose}>{t("common.action.cancel")}</Button>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};

export default AgentSetupPanel;
