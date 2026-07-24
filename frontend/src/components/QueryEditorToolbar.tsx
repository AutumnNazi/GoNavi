import React from "react";
import { Button, Dropdown, Select, Tooltip, type MenuProps } from "antd";
import {
  DiffOutlined,
  DownOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FormatPainterOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SearchOutlined,
  SaveOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";

import { t as defaultTranslate } from '../i18n';
import { useOptionalI18n } from '../i18n/provider';
import type { SavedConnection } from "../types";
import {
  getShortcutDisplayLabel,
  type ShortcutPlatform,
  type ShortcutPlatformBinding,
} from "../utils/shortcuts";
import QueryEditorTransactionSettings, {
  type SqlEditorCommitMode,
} from "./QueryEditorTransactionSettings";

type QueryEditorToolbarProps = {
  isV2Ui: boolean;
  currentConnectionId: string;
  currentDb: string;
  queryCapableConnections: SavedConnection[];
  dbList: string[];
  maxRows: number;
  sqlEditorCommitMode: SqlEditorCommitMode;
  sqlEditorAutoCommitDelayMs: number;
  pendingTransactionToolbar: React.ReactNode;
  runQueryShortcutBinding: ShortcutPlatformBinding;
  saveQueryShortcutBinding: ShortcutPlatformBinding;
  formatSqlShortcutBinding: ShortcutPlatformBinding;
  triggerSqlAiCompletionShortcutBinding: ShortcutPlatformBinding;
  toggleQueryResultsPanelShortcutBinding: ShortcutPlatformBinding;
  activeShortcutPlatform: ShortcutPlatform;
  isResultPanelVisible: boolean;
  wordWrapEnabled: boolean;
  loading: boolean;
  saveMoreMenuItems: MenuProps["items"];
  formatSettingsMenu: MenuProps["items"];
  onConnectionChange: (connectionId: string) => void;
  onDatabaseChange: (dbName: string) => void;
  onMaxRowsChange: (maxRows: number) => void;
  onCommitModeChange: (mode: SqlEditorCommitMode) => void;
  onAutoCommitDelayMsChange: (delayMs: number) => void;
  onCaptureEditorCursorPosition: () => void;
  onRun: () => void;
  onCancel: () => void;
  onQuickSave: () => void;
  onFindInEditor: () => void;
  onToggleWordWrap: () => void;
  onFormat: () => void;
  onTriggerSqlAiCompletion: () => void;
  onToggleResultPanelVisibility: () => void;
  onAIAction: (action: "generate" | "explain" | "optimize" | "schema") => void;
  /** object-edit 视图：验证数据变化入口 */
  showViewDataVerify?: boolean;
  onViewDataVerify?: () => void;
};

const FULL_NAME_TOOLTIP_DELAY_SECONDS = 1;

const WrapTextIcon: React.FC = () => (
  <svg
    className="gn-query-toolbar-word-wrap-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="currentColor"
      d="M4 19h6v-2H4v2zM20 5H4v2h16V5zm-3 6H4v2h13.25c1.1 0 2 .9 2 2s-.9 2-2 2H15v-2l-3 3 3 3v-2h2c2.21 0 4-1.79 4-4s-1.79-4-4-4z"
    />
  </svg>
);

type FullNameSelectOption = {
  label: string;
  value: string;
  title: string;
  fullName: string;
};

const renderFullNameSelectTooltip = (fullName: React.ReactNode) => {
  const fullNameText = String(fullName ?? "");

  return (
    <Tooltip
      title={fullNameText}
      mouseEnterDelay={FULL_NAME_TOOLTIP_DELAY_SECONDS}
      placement="topLeft"
    >
      <span
        className="gn-query-toolbar-select-full-name"
        aria-label={fullNameText}
      >
        {fullNameText}
      </span>
    </Tooltip>
  );
};

const QueryEditorToolbar: React.FC<QueryEditorToolbarProps> = ({
  isV2Ui,
  currentConnectionId,
  currentDb,
  queryCapableConnections,
  dbList,
  maxRows,
  sqlEditorCommitMode,
  sqlEditorAutoCommitDelayMs,
  pendingTransactionToolbar,
  runQueryShortcutBinding,
  saveQueryShortcutBinding,
  formatSqlShortcutBinding,
  triggerSqlAiCompletionShortcutBinding,
  toggleQueryResultsPanelShortcutBinding,
  activeShortcutPlatform,
  isResultPanelVisible,
  wordWrapEnabled,
  loading,
  saveMoreMenuItems,
  formatSettingsMenu,
  onConnectionChange,
  onDatabaseChange,
  onMaxRowsChange,
  onCommitModeChange,
  onAutoCommitDelayMsChange,
  onCaptureEditorCursorPosition,
  onRun,
  onCancel,
  onQuickSave,
  onFindInEditor,
  onToggleWordWrap,
  onFormat,
  onTriggerSqlAiCompletion,
  onToggleResultPanelVisibility,
  onAIAction,
  showViewDataVerify = false,
  onViewDataVerify,
}) => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? defaultTranslate;
  const baseMoreMenuItems = saveMoreMenuItems ?? [];
  const connectionSelectOptions: FullNameSelectOption[] =
    queryCapableConnections.map((connection) => ({
      label: connection.name,
      value: connection.id,
      title: "",
      fullName: connection.name,
    }));
  const databaseSelectOptions: FullNameSelectOption[] = dbList.map((db) => ({
    label: db,
    value: db,
    title: "",
    fullName: db,
  }));
  const toggleResultPanelShortcutLabel =
    toggleQueryResultsPanelShortcutBinding.enabled &&
    toggleQueryResultsPanelShortcutBinding.combo
      ? getShortcutDisplayLabel(
          toggleQueryResultsPanelShortcutBinding.combo,
          activeShortcutPlatform,
        )
      : "";
  const toggleResultPanelTitle =
    toggleQueryResultsPanelShortcutBinding.enabled &&
    toggleQueryResultsPanelShortcutBinding.combo
      ? t(
          isResultPanelVisible
            ? "query_editor.action.hide_results_panel_with_shortcut"
            : "query_editor.action.show_results_panel_with_shortcut",
          { shortcut: toggleResultPanelShortcutLabel },
        )
      : isResultPanelVisible
        ? t("query_editor.action.hide_results_panel")
        : t("query_editor.action.show_results_panel");
  const formatSqlTitle =
    formatSqlShortcutBinding.enabled && formatSqlShortcutBinding.combo
      ? t("query_editor.action.format_sql_with_shortcut", {
          shortcut: getShortcutDisplayLabel(
            formatSqlShortcutBinding.combo,
            activeShortcutPlatform,
          ),
        })
      : t("query_editor.action.format_sql");
  const findInEditorShortcutCombo =
    activeShortcutPlatform === "mac" ? "Meta+F" : "Ctrl+F";
  const findInEditorTitle = t(
    "query_editor.action.find_in_editor_with_shortcut",
    {
      shortcut: getShortcutDisplayLabel(
        findInEditorShortcutCombo,
        activeShortcutPlatform,
      ),
    },
  );
  const triggerSqlAiCompletionLabel =
    triggerSqlAiCompletionShortcutBinding.enabled &&
    triggerSqlAiCompletionShortcutBinding.combo
      ? `${t("app.shortcuts.action.triggerSqlAiCompletion.label")} · ${getShortcutDisplayLabel(
          triggerSqlAiCompletionShortcutBinding.combo,
          activeShortcutPlatform,
        )}`
      : t("app.shortcuts.action.triggerSqlAiCompletion.label");
  const aiMenuItems: MenuProps["items"] = [
    {
      key: "ai-inline-completion",
      label: triggerSqlAiCompletionLabel,
      icon: <RobotOutlined />,
      onClick: onTriggerSqlAiCompletion,
    },
    { type: "divider" as const },
    {
      key: "ai-generate",
      label: t("query_editor.action.ai_text_to_sql_menu"),
      icon: <RobotOutlined />,
      onClick: () => onAIAction("generate"),
    },
    {
      key: "ai-explain",
      label: t("query_editor.action.ai_explain_sql_menu"),
      icon: <RobotOutlined />,
      onClick: () => onAIAction("explain"),
    },
    {
      key: "ai-optimize",
      label: t("query_editor.action.ai_optimize_sql_menu"),
      icon: <RobotOutlined />,
      onClick: () => onAIAction("optimize"),
    },
    { type: "divider" as const },
    {
      key: "ai-schema",
      label: t("query_editor.action.ai_schema_analysis"),
      icon: <RobotOutlined />,
      onClick: () => onAIAction("schema"),
    },
  ];
  const moreMenuItems: MenuProps["items"] = isV2Ui
    ? [
        ...baseMoreMenuItems,
        ...(baseMoreMenuItems.length > 0 ? [{ type: "divider" as const }] : []),
        {
          key: "toggle-result-panel",
          label: toggleResultPanelTitle,
          icon: isResultPanelVisible ? (
            <EyeInvisibleOutlined />
          ) : (
            <EyeOutlined />
          ),
          onClick: onToggleResultPanelVisibility,
        },
      ]
    : baseMoreMenuItems;
  const selects = (
    <div
      className={isV2Ui ? "gn-v2-query-toolbar-selects" : undefined}
      style={{
        display: "flex",
        gap: "8px",
        flexShrink: 0,
        alignItems: "center",
      }}
    >
      <Select
        className={
          isV2Ui
            ? "gn-v2-query-toolbar-select gn-v2-query-toolbar-connection-select"
            : undefined
        }
        style={isV2Ui ? undefined : { width: 150 }}
        placeholder={t("query_editor.placeholder.connection")}
        value={currentConnectionId}
        onChange={onConnectionChange}
        options={connectionSelectOptions}
        optionFilterProp="label"
        optionRender={(option) => renderFullNameSelectTooltip(option.data.fullName)}
        labelRender={(option) => renderFullNameSelectTooltip(option.label ?? option.value)}
        showSearch
      />
      <Select
        className={
          isV2Ui
            ? "gn-v2-query-toolbar-select gn-v2-query-toolbar-database-select"
            : undefined
        }
        style={isV2Ui ? undefined : { width: 200 }}
        placeholder={t("query_editor.placeholder.database")}
        value={currentDb}
        onChange={onDatabaseChange}
        options={databaseSelectOptions}
        optionFilterProp="label"
        optionRender={(option) => renderFullNameSelectTooltip(option.data.fullName)}
        labelRender={(option) => renderFullNameSelectTooltip(option.label ?? option.value)}
        showSearch
      />
      <Tooltip title={t("query_editor.max_rows.tooltip")}>
        <Select
          className={
            isV2Ui
              ? "gn-v2-query-toolbar-select gn-v2-query-toolbar-max-rows-select"
              : undefined
          }
          style={isV2Ui ? undefined : { width: 170 }}
          value={maxRows}
          onChange={(val) => onMaxRowsChange(Number(val))}
          options={[
            { label: '100', value: 100 },
            { label: t("query_editor.max_rows.option_500"), value: 500 },
            { label: t("query_editor.max_rows.option_1000"), value: 1000 },
            { label: t("query_editor.max_rows.option_5000"), value: 5000 },
            { label: t("query_editor.max_rows.option_20000"), value: 20000 },
            { label: t("query_editor.max_rows.option_unlimited"), value: 0 },
          ]}
        />
      </Tooltip>
      <QueryEditorTransactionSettings
        isV2Ui={isV2Ui}
        commitMode={sqlEditorCommitMode}
        autoCommitDelayMs={sqlEditorAutoCommitDelayMs}
        onCommitModeChange={onCommitModeChange}
        onAutoCommitDelayMsChange={onAutoCommitDelayMsChange}
      />
      {!isV2Ui && pendingTransactionToolbar}
    </div>
  );

  const actions = (
    <div
      className={isV2Ui ? "gn-v2-query-toolbar-actions" : undefined}
      style={{
        display: "flex",
        gap: "8px",
        flexShrink: 0,
        alignItems: "center",
      }}
    >
      <div
        className={isV2Ui ? "gn-v2-query-toolbar-action-group" : undefined}
        style={{ display: "flex", gap: "8px", alignItems: "center" }}
      >
        <Tooltip
          title={
            runQueryShortcutBinding.enabled && runQueryShortcutBinding.combo
              ? t("query_editor.action.run_with_shortcut", {
                  shortcut: getShortcutDisplayLabel(
                    runQueryShortcutBinding.combo,
                    activeShortcutPlatform,
                  ),
                })
              : t("query_editor.action.run")
          }
        >
          <Button
            className={isV2Ui ? "gn-v2-query-toolbar-run-action" : undefined}
            type="primary"
            icon={<PlayCircleOutlined />}
            onMouseDown={onCaptureEditorCursorPosition}
            onClick={onRun}
            loading={loading}
          >
            {t("query_editor.action.run")}
          </Button>
          {showViewDataVerify && onViewDataVerify && (
            <Tooltip title={t("result_diff.view_verify.toolbar.tooltip")}>
              <Button
                icon={<DiffOutlined />}
                disabled={loading}
                onClick={onViewDataVerify}
              >
                {t("result_diff.view_verify.toolbar")}
              </Button>
            </Tooltip>
          )}
        </Tooltip>
        {loading && (
          <Button
            type="primary"
            danger
            icon={<StopOutlined />}
            onClick={onCancel}
          >
            {t("query_editor.action.stop")}
          </Button>
        )}
      </div>
      {isV2Ui && pendingTransactionToolbar}
      <div
        className={isV2Ui ? "gn-v2-query-toolbar-action-pair" : undefined}
        style={{ display: "flex", gap: "8px", alignItems: "center" }}
      >
        <Tooltip
          title={
            saveQueryShortcutBinding.enabled && saveQueryShortcutBinding.combo
              ? t("query_editor.action.save_with_shortcut", {
                  shortcut: getShortcutDisplayLabel(
                    saveQueryShortcutBinding.combo,
                    activeShortcutPlatform,
                  ),
                })
              : t("query_editor.action.save")
          }
        >
          <Button
            className={isV2Ui ? "gn-v2-query-toolbar-save-action" : undefined}
            type="primary"
            icon={<SaveOutlined />}
            onClick={onQuickSave}
          >
            {t("query_editor.action.save")}
          </Button>
        </Tooltip>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <Tooltip title={triggerSqlAiCompletionLabel}>
            <Button
              className={isV2Ui ? "gn-v2-query-toolbar-ai-action" : undefined}
              icon={<RobotOutlined />}
              style={{ color: "#818cf8" }}
              onMouseDown={onCaptureEditorCursorPosition}
              onClick={onTriggerSqlAiCompletion}
            >
              AI
            </Button>
          </Tooltip>
          <Dropdown
            menu={{ items: aiMenuItems }}
            placement="bottomRight"
            trigger={["click"]}
          >
            <Button
              className={isV2Ui ? "gn-v2-query-toolbar-icon-action" : undefined}
              icon={<DownOutlined />}
              aria-label="AI more actions"
              onMouseDown={onCaptureEditorCursorPosition}
            />
          </Dropdown>
        </div>
        <Dropdown
          menu={{ items: moreMenuItems }}
          placement="bottomRight"
          trigger={["click"]}
        >
          <Button>{t("query_editor.action.more")}</Button>
        </Dropdown>
      </div>

      <div
        className={isV2Ui ? "gn-v2-query-toolbar-action-pair" : undefined}
        style={{ display: "flex", gap: "8px", alignItems: "center" }}
      >
        <Tooltip title={findInEditorTitle}>
          <Button icon={<SearchOutlined />} onClick={onFindInEditor}>
            {t("query_editor.action.find_in_editor")}
          </Button>
        </Tooltip>
        <Tooltip
          title={t(
            wordWrapEnabled
              ? "query_editor.action.disable_word_wrap"
              : "query_editor.action.enable_word_wrap",
          )}
        >
          <Button
            className={isV2Ui ? "gn-v2-query-toolbar-word-wrap-action" : undefined}
            type={wordWrapEnabled ? "primary" : "default"}
            icon={<WrapTextIcon />}
            aria-label={t(
              wordWrapEnabled
                ? "query_editor.action.disable_word_wrap"
                : "query_editor.action.enable_word_wrap",
            )}
            aria-pressed={wordWrapEnabled}
            onClick={onToggleWordWrap}
          >
            {t("query_editor.action.word_wrap")}
          </Button>
        </Tooltip>
        <Tooltip title={formatSqlTitle}>
          <Button icon={<FormatPainterOutlined />} onClick={onFormat}>
            {t("query_editor.action.format")}
          </Button>
        </Tooltip>
        <Dropdown
          menu={{ items: formatSettingsMenu }}
          placement="bottomRight"
          trigger={["click"]}
        >
          <Button
            className={isV2Ui ? "gn-v2-query-toolbar-icon-action" : undefined}
            icon={<SettingOutlined />}
          />
        </Dropdown>
      </div>

      {!isV2Ui && (
        <Tooltip title={toggleResultPanelTitle}>
          <Button
            icon={
              isResultPanelVisible ? <EyeInvisibleOutlined /> : <EyeOutlined />
            }
            onClick={onToggleResultPanelVisibility}
          >
            {t("query_editor.action.results")}
          </Button>
        </Tooltip>
      )}
    </div>
  );

  if (!isV2Ui) {
    return (
      <div
        className={undefined}
        style={{
          padding: "4px 8px 8px",
          display: "flex",
          gap: "8px",
          flexShrink: 0,
          alignItems: "center",
        }}
      >
        {selects}
        {actions}
      </div>
    );
  }

  return (
    <div
      className="gn-v2-query-toolbar"
      style={{
        padding: "4px 8px 8px",
        display: "flex",
        gap: "8px",
        flexShrink: 0,
      }}
    >
      <div
        className="gn-v2-query-toolbar-main"
        style={{
          display: "flex",
          gap: "8px",
          flexShrink: 0,
          alignItems: "center",
        }}
      >
        {selects}
        {actions}
      </div>
    </div>
  );
};

export default QueryEditorToolbar;
