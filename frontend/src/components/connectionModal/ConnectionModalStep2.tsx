import React, { type ReactNode } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  ApiOutlined,
  BgColorsOutlined,
  CloudOutlined,
  ClusterOutlined,
  CodeOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  GatewayOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";

import {
  DB_ICON_TYPES,
  PRESET_ICON_COLORS,
  getDbDefaultColor,
  getDbIcon,
  getDbIconLabel,
} from "../DatabaseIcons";
import ConnectionModalMongoSections from "../ConnectionModalMongoSections";
import ConnectionModalRedisSections from "../ConnectionModalRedisSections";
import { t } from "../../i18n";
import {
  supportsConnectionReadOnlyMode,
} from "../../utils/connectionReadOnly";
import {
  getConnectionConfigLayoutKindLabel,
  getStoredSecretPlaceholder,
} from "../../utils/connectionModalPresentation";
import { getCustomConnectionDriverHelp } from "../../utils/driverImportGuidance";
import { noAutoCapInputProps } from "../../utils/inputAutoCap";
import {
  JVM_EDITABLE_MODES,
  normalizeEditableJVMModes,
} from "../../utils/jvmConnectionConfig";
import { resolveJVMModeMeta } from "../../utils/jvmRuntimePresentation";
import {
  getConnectionParamsPlaceholder,
  getUriPlaceholder,
} from "./connectionModalUri";
import ConnectionModalNetworkSecuritySection from "./ConnectionModalNetworkSecuritySection";
import type { MongoMemberInfo } from "../../types";

const { Text } = Typography;

const CLICKHOUSE_PROTOCOL_OPTIONS: Array<{
  value: "auto" | "http" | "native";
  label?: string;
  labelKey?: string;
}> = [
  { value: "auto", labelKey: "connection.modal.field.clickHouseProtocol.auto" },
  { value: "http", label: "HTTP" },
  { value: "native", label: "Native" },
];

const OCEANBASE_PROTOCOL_OPTIONS: Array<{
  value: "mysql" | "oracle";
  label: string;
}> = [
  { value: "mysql", label: "MySQL" },
  { value: "oracle", label: "Oracle" },
];

const PRIMARY_USERNAME_OPTIONAL_TYPES = new Set([
  "mongodb",
  "elasticsearch",
  "chroma",
  "qdrant",
  "milvus",
  "rocketmq",
  "mqtt",
  "kafka",
  "rabbitmq",
]);

type ConnectionModalStep2Props = Record<string, any>;

const ConnectionModalStep2: React.FC<ConnectionModalStep2Props> = (props) => {
  const {
    activeConfigSection,
    activeNetworkConfig,
    buildRedisDatabaseList,
    clearConnectionTestResultForChoice,
    connectionConfigLayout,
    createCustomDsnRule,
    createUriAwareRequiredRule,
    currentDriverSnapshot,
    currentDriverUnavailableReason,
    currentDriverUpdateReason,
    customIconColor,
    customIconType,
    darkMode,
    dbList,
    dbType,
    discoveringMembers,
    form,
    getConnectionOptionCardStyle,
    handleCopyURI,
    handleDiscoverMongoMembers,
    handleGenerateURI,
    handleJvmModeCardSelect,
    handleJvmModeToggle,
    handleParseURI,
    handleSelectCertificateFile,
    handleSelectDatabaseFile,
    handleSelectSSHKeyFile,
    initialValues,
    isCustom,
    isFileDb,
    isJVM,
    isKafka,
    isMQTT,
    isMySQLLike,
    isOceanBaseOracle,
    isRedis,
    isRocketMQ,
    isSSLType,
    jvmDiagnosticEnabled,
    jvmDiagnosticTransport,
    jvmEnvironment,
    jvmPreferredMode,
    jvmSectionCardStyle,
    kafkaTopology,
    modalInnerSectionStyle,
    modalMutedTextStyle,
    mongoAuthMechanism,
    mongoMembers,
    mongoReadPreference,
    mongoSrv,
    mongoTopology,
    mqttTopology,
    mysqlTopology,
    normalizeRedisDatabaseSelection,
    normalizedJvmAllowedModes,
    oceanBaseProtocol,
    onOpenDriverManager,
    primaryPasswordVisible,
    proxyType,
    redisDbList,
    redisTopology,
    renderChoiceCards,
    renderConfigSectionCard,
    renderJvmSectionHeader,
    renderStoredSecretControls,
    resolvedUriFeedbackMessage,
    rocketmqTopology,
    selectingCertificateField,
    selectingDbFile,
    selectingSSHKey,
    setActiveConfigSection,
    setActiveNetworkConfig,
    setChoiceFieldValue,
    setCustomIconColor,
    setCustomIconType,
    setDbType,
    setMongoMembers,
    setPrimaryPasswordVisible,
    setRedisDbList,
    setTestErrorLogOpen,
    setTestResult,
    setUriFeedback,
    setUseHttpTunnel,
    setUseProxy,
    setUseSSH,
    setUseSSL,
    sslHintText,
    sslMode,
    supportsConnectionParams,
    supportsSSLCAPath,
    supportsSSLClientCertificate,
    testResult,
    tunnelSectionStyle,
    unsupportedJvmModeMessage,
    uriFeedback,
    useHttpTunnel,
    useProxy,
    useSSH,
    useSSL,
  } = props;

  const [readOnlyProtectionExpanded, setReadOnlyProtectionExpanded] =
    React.useState(false);

  React.useEffect(() => {
    setReadOnlyProtectionExpanded(false);
  }, [dbType]);

  const renderStep2 = () => {
  const showConnectionReadOnlyField = supportsConnectionReadOnlyMode({
    type: dbType,
    driver: form.getFieldValue("driver"),
    oceanBaseProtocol,
  });
  const restrictDataEdit = Form.useWatch("restrictDataEdit", form) === true;
  const restrictStructureEdit =
    Form.useWatch("restrictStructureEdit", form) === true;
  const restrictScriptExecution =
    Form.useWatch("restrictScriptExecution", form) === true;
  const restrictDataImport =
    Form.useWatch("restrictDataImport", form) === true;
  const connectionProtectionEnabledCount = [
    restrictDataEdit,
    restrictStructureEdit,
    restrictScriptExecution,
    restrictDataImport,
  ].filter(Boolean).length;
  const baseInfoSection = (
    <div style={modalInnerSectionStyle}>
      <div
        style={{
          marginBottom: 12,
          color: darkMode ? "#f5f7ff" : "#162033",
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        {t("connection.modal.config.basic.title")}
      </div>
      <div style={{ ...modalMutedTextStyle, marginBottom: 16 }}>
        {t("connection.modal.config.basic.description")}
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        {renderConfigSectionCard({
          sectionKey: "identity",
          icon: <ApiOutlined />,
          badge: (
            <Tag>
              {getConnectionConfigLayoutKindLabel(connectionConfigLayout.kind)}
            </Tag>
          ),
          children: (
            <Form.Item
              name="name"
              label={t("connection.modal.field.name.label")}
              style={{ marginBottom: 0 }}
            >
              <Input
                {...noAutoCapInputProps}
                placeholder={
                  isJVM
                    ? t("connection.modal.field.name.placeholder.jvm")
                    : t("connection.modal.field.name.placeholder.default")
                }
              />
            </Form.Item>
          ),
        })}

        {!isCustom &&
          !isJVM &&
          renderConfigSectionCard({
            sectionKey: "uri",
            icon: <LinkOutlined />,
            children: (
              <>
                <Form.Item
                  name="uri"
                  label={t("connection.modal.uri.label")}
                  help={t("connection.modal.uri.help")}
                >
                  <Input.TextArea
                    {...noAutoCapInputProps}
                    rows={3}
                    placeholder={getUriPlaceholder(dbType)}
                  />
                </Form.Item>
                {supportsConnectionParams && (
                  <Form.Item
                    name="connectionParams"
                    label={t("connection.modal.connectionParams.label")}
                    help={t("connection.modal.connectionParams.help")}
                  >
                    <Input.TextArea
                      {...noAutoCapInputProps}
                      rows={2}
                      placeholder={getConnectionParamsPlaceholder(dbType, oceanBaseProtocol)}
                    />
                  </Form.Item>
                )}
                <Space
                  size={8}
                  style={{ marginBottom: uriFeedback ? 12 : 16 }}
                  wrap
                >
                  <Button onClick={handleGenerateURI}>
                    {t("connection.modal.uri.action.generate")}
                  </Button>
                  <Button onClick={handleParseURI}>
                    {t("connection.modal.uri.action.parse")}
                  </Button>
                  <Button onClick={handleCopyURI}>
                    {t("connection.modal.uri.action.copy")}
                  </Button>
                </Space>
                {uriFeedback && (
                  <Alert
                    showIcon
                    closable
                    type={uriFeedback.type}
                    message={resolvedUriFeedbackMessage}
                    onClose={() => setUriFeedback(null)}
                    style={{ marginBottom: 16 }}
                  />
                )}
                {renderStoredSecretControls({
                  fieldName: "uri",
                  clearKey: "opaqueURI",
                  hasStoredSecret: initialValues?.hasOpaqueURI,
                  clearLabel: t("connection.modal.uri.stored.clear"),
                  description: t("connection.modal.uri.stored.description"),
                })}
              </>
            ),
          })}

        {isCustom ? (
          <>
            {renderConfigSectionCard({
              sectionKey: "customDriver",
              icon: <CodeOutlined />,
              children: (
                <Form.Item
                  name="driver"
                  label={t("connection.modal.field.driver.label")}
                  rules={[
                    {
                      required: true,
                      message: t("connection.modal.field.driver.required"),
                    },
                  ]}
                  help={getCustomConnectionDriverHelp()}
                  style={{ marginBottom: 0 }}
                >
                  <Input
                    {...noAutoCapInputProps}
                    placeholder={t("connection.modal.field.driver.placeholder")}
                  />
                </Form.Item>
              ),
            })}
            {renderConfigSectionCard({
              sectionKey: "customDsn",
              icon: <FileTextOutlined />,
              children: (
                <>
                  <Form.Item
                    name="dsn"
                    label={t("connection.modal.field.dsn.label")}
                    rules={[createCustomDsnRule()]}
                  >
                    <Input.TextArea
                      {...noAutoCapInputProps}
                      rows={4}
                      placeholder={t("connection.modal.field.dsn.placeholder")}
                    />
                  </Form.Item>
                  {renderStoredSecretControls({
                    fieldName: "dsn",
                    clearKey: "opaqueDSN",
                    hasStoredSecret: initialValues?.hasOpaqueDSN,
                    clearLabel: t("connection.modal.field.dsn.clearSaved"),
                    description: t(
                      "connection.modal.field.dsn.savedDescription",
                    ),
                  })}
                </>
              ),
            })}
          </>
        ) : isJVM ? (
        <>
          {unsupportedJvmModeMessage && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={t("connection.modal.jvm.unsupportedMode.alert")}
              description={unsupportedJvmModeMessage}
            />
          )}
          <div style={{ display: "grid", gap: 16 }}>
            <div style={jvmSectionCardStyle()}>
              {renderJvmSectionHeader(
                <GatewayOutlined />,
                t("connection.modal.jvm.target.title"),
                t("connection.modal.jvm.target.description"),
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 120px",
                  gap: 16,
                  alignItems: "start",
                }}
              >
                <Form.Item
                  name="host"
                  label={t("connection.modal.jvm.host.label")}
                  rules={[
                    {
                      required: true,
                      message: t("connection.modal.jvm.host.required"),
                    },
                  ]}
                  style={{ marginBottom: 0 }}
                >
                  <Input
                    {...noAutoCapInputProps}
                    placeholder={t("connection.modal.example", {
                      value: "localhost",
                    })}
                  />
                </Form.Item>
                <Form.Item
                  name="port"
                  label={t("connection.modal.jvm.port.label")}
                  rules={[
                    {
                      required: true,
                      message: t("connection.modal.jvm.port.required"),
                    },
                  ]}
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber style={{ width: "100%" }} min={1} max={65535} />
                </Form.Item>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 16,
                  marginTop: 16,
                }}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  <Text strong>
                    {t("connection.modal.jvm.environment.title")}
                  </Text>
                  {renderChoiceCards({
                    fieldName: "jvmEnvironment",
                    value: String(jvmEnvironment),
                    minWidth: 120,
                    options: [
                      {
                        value: "dev",
                        label: t(
                          "connection.modal.jvm.environment.dev.label",
                        ),
                        description: t(
                          "connection.modal.jvm.environment.dev.description",
                        ),
                      },
                      {
                        value: "uat",
                        label: t(
                          "connection.modal.jvm.environment.staging.label",
                        ),
                        description: t(
                          "connection.modal.jvm.environment.staging.description",
                        ),
                      },
                      {
                        value: "prod",
                        label: t(
                          "connection.modal.jvm.environment.prod.label",
                        ),
                        description: t(
                          "connection.modal.jvm.environment.prod.description",
                        ),
                      },
                    ],
                  })}
                </div>
                <Form.Item
                  name="timeout"
                  label={t("connection.modal.network.timeout.label")}
                  rules={[
                    {
                      type: "number",
                      min: 1,
                      max: 300,
                      message: t("connection.modal.network.timeout.range"),
                    },
                  ]}
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={1}
                    max={300}
                    placeholder={t("connection.modal.example", {
                      value: "30",
                    })}
                  />
                </Form.Item>
                <Form.Item
                  name="jvmReadOnly"
                  label={t("connection.modal.jvm.securityPolicy.label")}
                  valuePropName="checked"
                  style={{ marginBottom: 0 }}
                >
                  <Checkbox>{t("connection.modal.jvm.readonlyPreferred")}</Checkbox>
                </Form.Item>
              </div>
            </div>

            <div style={jvmSectionCardStyle()}>
              {renderJvmSectionHeader(
                <ClusterOutlined />,
                t("connection.modal.jvm.accessMode.title"),
                t("connection.modal.jvm.accessMode.description"),
              )}
              <Form.Item
                name="jvmAllowedModes"
                hidden
                rules={[
                  {
                    required: true,
                    message: t("connection.modal.jvm.accessMode.required"),
                  },
                ]}
              >
                <Select mode="multiple" />
              </Form.Item>
              <Form.Item
                name="jvmPreferredMode"
                hidden
                rules={[
                  {
                    required: true,
                    message: t("connection.modal.jvm.preferredMode.required"),
                  },
                ]}
              >
                <Input {...noAutoCapInputProps} />
              </Form.Item>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 14,
                }}
              >
                {JVM_EDITABLE_MODES.map((mode) => {
                  const meta = resolveJVMModeMeta(mode);
                  const enabled = normalizedJvmAllowedModes.includes(mode);
                  const preferred = jvmPreferredMode === mode;
                  return (
                    <div
                      key={mode}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleJvmModeCardSelect(mode)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleJvmModeCardSelect(mode);
                        }
                      }}
                      aria-pressed={enabled}
                      style={{
                        textAlign: "left",
                        padding: 14,
                        borderRadius: 16,
                        border: enabled
                          ? darkMode
                            ? "1px solid rgba(255,214,102,0.36)"
                            : "1px solid rgba(22,119,255,0.34)"
                          : darkMode
                            ? "1px solid rgba(255,255,255,0.08)"
                            : "1px solid rgba(16,24,40,0.08)",
                        background: enabled
                          ? darkMode
                            ? "rgba(255,214,102,0.08)"
                            : "rgba(22,119,255,0.06)"
                          : darkMode
                            ? "rgba(255,255,255,0.03)"
                            : "rgba(16,24,40,0.03)",
                        boxShadow: preferred
                          ? darkMode
                            ? "0 0 0 2px rgba(255,214,102,0.12)"
                            : "0 0 0 2px rgba(22,119,255,0.10)"
                          : "none",
                        color: darkMode ? "#f5f7ff" : "#162033",
                        cursor: "pointer",
                        transition: "all 120ms ease",
                      }}
                    >
                      <Space size={8} wrap>
                        <Tag color={enabled ? "blue" : "default"}>
                          {meta.label}
                        </Tag>
                        {preferred ? (
                          <Tag color="green">
                            {t("connection.modal.jvm.tag.preferred")}
                          </Tag>
                        ) : null}
                        {!enabled ? (
                          <Tag>{t("connection.modal.jvm.tag.notEnabled")}</Tag>
                        ) : null}
                      </Space>
                      <div style={{ ...modalMutedTextStyle, marginTop: 8 }}>
                        {mode === "jmx"
                          ? t("connection.modal.jvm.mode.jmx.description")
                          : mode === "endpoint"
                            ? t(
                                "connection.modal.jvm.mode.endpoint.description",
                              )
                            : t("connection.modal.jvm.mode.agent.description")}
                      </div>
                      <Button
                        size="small"
                        type={enabled ? "default" : "primary"}
                        disabled={enabled && normalizedJvmAllowedModes.length <= 1}
                        onClick={(event) => handleJvmModeToggle(mode, event)}
                        style={{ marginTop: 12, borderRadius: 999 }}
                      >
                        {enabled
                          ? t("connection.modal.jvm.mode.disable")
                          : t("connection.modal.jvm.mode.enablePreferred")}
                      </Button>
                    </div>
                  );
                })}
              </div>
              <div style={{ ...modalMutedTextStyle, marginTop: 12 }}>
                {t("connection.modal.jvm.preferredSummary", {
                  mode: resolveJVMModeMeta(String(jvmPreferredMode || "jmx"))
                    .label,
                })}
              </div>
            </div>

            <div style={jvmSectionCardStyle()}>
              {renderJvmSectionHeader(
                <ApiOutlined />,
                "JMX",
                t("connection.modal.jvm.jmx.description"),
                <Tag color={normalizedJvmAllowedModes.includes("jmx") ? "green" : "default"}>
                  {normalizedJvmAllowedModes.includes("jmx")
                    ? t("connection.modal.jvm.tag.enabled")
                    : t("connection.modal.jvm.tag.notEnabled")}
                </Tag>,
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 120px",
                  gap: 16,
                }}
              >
                <Form.Item
                  name="jvmJmxHost"
                  label={t("connection.modal.jvm.jmx.host.label")}
                  style={{ marginBottom: 0 }}
                >
                  <Input
                    {...noAutoCapInputProps}
                    disabled={!normalizedJvmAllowedModes.includes("jmx")}
                    placeholder={t("connection.modal.jvm.jmx.host.placeholder")}
                  />
                </Form.Item>
                <Form.Item
                  name="jvmJmxPort"
                  label={t("connection.modal.jvm.jmx.port.label")}
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={1}
                    max={65535}
                    disabled={!normalizedJvmAllowedModes.includes("jmx")}
                    placeholder={t("connection.modal.jvm.jmx.port.placeholder")}
                  />
                </Form.Item>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 16,
                  marginTop: 16,
                }}
              >
                <Form.Item
                  name="jvmJmxUsername"
                  label={t("connection.modal.jvm.jmx.username.label")}
                  style={{ marginBottom: 0 }}
                >
                  <Input
                    {...noAutoCapInputProps}
                    disabled={!normalizedJvmAllowedModes.includes("jmx")}
                    placeholder={t(
                      "connection.modal.jvm.jmx.username.placeholder",
                    )}
                  />
                </Form.Item>
                <Form.Item
                  name="jvmJmxPassword"
                  label={t("connection.modal.jvm.jmx.password.label")}
                  style={{ marginBottom: 0 }}
                >
                  <Input.Password
                    {...noAutoCapInputProps}
                    disabled={!normalizedJvmAllowedModes.includes("jmx")}
                    placeholder={t(
                      "connection.modal.jvm.jmx.password.placeholder",
                    )}
                  />
                </Form.Item>
              </div>
            </div>

            <div style={jvmSectionCardStyle()}>
              {renderJvmSectionHeader(
                <CodeOutlined />,
                "Endpoint",
                t("connection.modal.jvm.endpoint.description"),
                <Tag
                  color={
                    normalizedJvmAllowedModes.includes("endpoint")
                      ? "green"
                      : "default"
                  }
                >
                  {normalizedJvmAllowedModes.includes("endpoint")
                    ? t("connection.modal.jvm.tag.enabled")
                    : t("connection.modal.jvm.tag.notEnabled")}
                </Tag>,
              )}
              <Form.Item
                name="jvmEndpointBaseUrl"
                label={t("connection.modal.jvm.endpoint.address.label")}
                rules={[
                  {
                    required: jvmPreferredMode === "endpoint",
                    message: t(
                      "connection.modal.jvm.endpoint.address.required",
                    ),
                  },
                ]}
                help={t("connection.modal.jvm.endpoint.address.help")}
              >
                <Input
                  {...noAutoCapInputProps}
                  disabled={!normalizedJvmAllowedModes.includes("endpoint")}
                  placeholder={t(
                    "connection.modal.jvm.endpoint.address.placeholder",
                  )}
                />
              </Form.Item>
              <Form.Item
                name="jvmEndpointApiKey"
                label={t("connection.modal.jvm.endpoint.apiKey.label")}
                style={{ marginBottom: 0 }}
              >
                <Input.Password
                  {...noAutoCapInputProps}
                  disabled={!normalizedJvmAllowedModes.includes("endpoint")}
                  placeholder={t(
                    "connection.modal.jvm.endpoint.apiKey.placeholder",
                  )}
                />
              </Form.Item>
            </div>

            <div style={jvmSectionCardStyle()}>
              {renderJvmSectionHeader(
                <ThunderboltOutlined />,
                "Agent",
                t("connection.modal.jvm.agent.description"),
                <Tag color={normalizedJvmAllowedModes.includes("agent") ? "green" : "default"}>
                  {normalizedJvmAllowedModes.includes("agent")
                    ? t("connection.modal.jvm.tag.enabled")
                    : t("connection.modal.jvm.tag.notEnabled")}
                </Tag>,
              )}
              <Form.Item
                name="jvmAgentBaseUrl"
                label={t("connection.modal.jvm.agent.address.label")}
                rules={[
                  {
                    required: jvmPreferredMode === "agent",
                    message: t("connection.modal.jvm.agent.address.required"),
                  },
                ]}
                help={t("connection.modal.jvm.agent.address.help")}
              >
                <Input
                  {...noAutoCapInputProps}
                  disabled={!normalizedJvmAllowedModes.includes("agent")}
                  placeholder={t(
                    "connection.modal.jvm.agent.address.placeholder",
                  )}
                />
              </Form.Item>
              <Form.Item
                name="jvmAgentApiKey"
                label={t("connection.modal.jvm.agent.apiKey.label")}
                style={{ marginBottom: 0 }}
              >
                <Input.Password
                  {...noAutoCapInputProps}
                  disabled={!normalizedJvmAllowedModes.includes("agent")}
                  placeholder={t(
                    "connection.modal.jvm.agent.apiKey.placeholder",
                  )}
                />
              </Form.Item>
            </div>

            <div style={jvmSectionCardStyle()}>
              {renderJvmSectionHeader(
                <SafetyCertificateOutlined />,
                t("connection.modal.jvm.diagnostic.title"),
                t("connection.modal.jvm.diagnostic.description"),
                <Form.Item
                  name="jvmDiagnosticEnabled"
                  valuePropName="checked"
                  style={{ marginBottom: 0 }}
                >
                  <Switch
                    checkedChildren={t("connection.modal.jvm.switch.on")}
                    unCheckedChildren={t("connection.modal.jvm.switch.off")}
                  />
                </Form.Item>,
              )}
              {jvmDiagnosticEnabled ? (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "220px minmax(0, 1fr)",
                      gap: 16,
                    }}
                  >
                    <div style={{ display: "grid", gap: 8 }}>
                      <Text strong>
                        {t("connection.modal.jvm.diagnostic.transport.label")}
                      </Text>
                      {renderChoiceCards({
                        fieldName: "jvmDiagnosticTransport",
                        value: String(jvmDiagnosticTransport),
                        options: [
                          {
                            value: "agent-bridge",
                            label: t(
                              "connection.modal.jvm.diagnostic.transport.agent_bridge",
                            ),
                            description: t(
                              "connection.modal.jvm.diagnostic.transport.agentBridge.description",
                            ),
                          },
                          {
                            value: "arthas-tunnel",
                            label: t(
                              "connection.modal.jvm.diagnostic.transport.arthas_tunnel",
                            ),
                            description: t(
                              "connection.modal.jvm.diagnostic.transport.arthasTunnel.description",
                            ),
                          },
                        ],
                      })}
                    </div>
                    <Form.Item
                      name="jvmDiagnosticBaseUrl"
                      label={
                        jvmDiagnosticTransport === "arthas-tunnel"
                          ? t(
                              "connection.modal.jvm.diagnostic.arthasTunnelAddress.label",
                            )
                          : t(
                              "connection.modal.jvm.diagnostic.bridgeAddress.label",
                            )
                      }
                      rules={[
                        {
                          required: true,
                          message:
                            jvmDiagnosticTransport === "arthas-tunnel"
                              ? t(
                                  "connection.modal.jvm.diagnostic.arthasTunnelAddress.required",
                                )
                              : t(
                                  "connection.modal.jvm.diagnostic.bridgeAddress.required",
                                ),
                        },
                      ]}
                      help={
                        jvmDiagnosticTransport === "arthas-tunnel"
                          ? t(
                              "connection.modal.jvm.diagnostic.arthasTunnelAddress.help",
                            )
                          : t(
                              "connection.modal.jvm.diagnostic.bridgeAddress.help",
                            )
                      }
                    >
                      <Input
                        {...noAutoCapInputProps}
                        placeholder={
                          jvmDiagnosticTransport === "arthas-tunnel"
                            ? "http://127.0.0.1:7777"
                            : "http://127.0.0.1:19091/gonavi/diag"
                        }
                      />
                    </Form.Item>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) 220px",
                      gap: 16,
                    }}
                  >
                    <Form.Item
                      name="jvmDiagnosticTargetId"
                      label={
                        jvmDiagnosticTransport === "arthas-tunnel"
                          ? t(
                              "connection.modal.jvm.diagnostic.targetId.agentId.label",
                            )
                          : t(
                              "connection.modal.jvm.diagnostic.targetId.label",
                            )
                      }
                      rules={
                        jvmDiagnosticTransport === "arthas-tunnel"
                          ? [
                              {
                                required: true,
                                message: t(
                                  "connection.modal.jvm.diagnostic.targetId.required",
                                ),
                              },
                            ]
                          : undefined
                      }
                      help={
                        jvmDiagnosticTransport === "arthas-tunnel"
                          ? t(
                              "connection.modal.jvm.diagnostic.targetId.arthasHelp",
                            )
                          : t(
                              "connection.modal.jvm.diagnostic.targetId.bridgeHelp",
                            )
                      }
                    >
                      <Input
                        {...noAutoCapInputProps}
                        placeholder={
                          jvmDiagnosticTransport === "arthas-tunnel"
                            ? t("connection.modal.example", {
                                value: "orders-app_A1B2C3D4E5",
                              })
                            : t("connection.modal.example", {
                                value: "orders-prod-01",
                              })
                        }
                      />
                    </Form.Item>
                    <Form.Item
                      name="jvmDiagnosticTimeoutSeconds"
                      label={t(
                        "connection.modal.jvm.diagnostic.timeout.label",
                      )}
                      rules={[
                        {
                          type: "number",
                          min: 1,
                          max: 300,
                          message: t(
                            "connection.modal.jvm.diagnostic.timeout.range",
                          ),
                        },
                      ]}
                    >
                      <InputNumber style={{ width: "100%" }} min={1} max={300} />
                    </Form.Item>
                  </div>
                  <Form.Item
                    name="jvmDiagnosticApiKey"
                    label={t("connection.modal.jvm.diagnostic.apiKey.label")}
                  >
                    <Input.Password
                      {...noAutoCapInputProps}
                      placeholder={t(
                        "connection.modal.jvm.diagnostic.apiKey.placeholder",
                      )}
                    />
                  </Form.Item>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 10,
                    }}
                  >
                    {[
                      {
                        name: "jvmDiagnosticAllowObserveCommands",
                        label: t(
                          "connection.modal.jvm.diagnostic.command.observe.label",
                        ),
                        description: t(
                          "connection.modal.jvm.diagnostic.command.observe.description",
                        ),
                      },
                      {
                        name: "jvmDiagnosticAllowTraceCommands",
                        label: t(
                          "connection.modal.jvm.diagnostic.command.trace.label",
                        ),
                        description: t(
                          "connection.modal.jvm.diagnostic.command.trace.description",
                        ),
                      },
                      {
                        name: "jvmDiagnosticAllowMutatingCommands",
                        label: t(
                          "connection.modal.jvm.diagnostic.command.mutating.label",
                        ),
                        description: t(
                          "connection.modal.jvm.diagnostic.command.mutating.description",
                        ),
                      },
                    ].map((item) => (
                      <div
                        key={item.name}
                        style={{
                          padding: 12,
                          borderRadius: 14,
                          background: darkMode
                            ? "rgba(255,255,255,0.04)"
                            : "rgba(16,24,40,0.04)",
                        }}
                      >
                        <Form.Item
                          name={item.name}
                          valuePropName="checked"
                          style={{ marginBottom: 6 }}
                        >
                          <Checkbox>{item.label}</Checkbox>
                        </Form.Item>
                        <div style={modalMutedTextStyle}>
                          {item.description}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    ...modalMutedTextStyle,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: darkMode
                      ? "rgba(255,255,255,0.04)"
                      : "rgba(16,24,40,0.04)",
                  }}
                >
                  {t("connection.modal.jvm.diagnostic.disabledHint")}
                </div>
              )}
            </div>
          </div>
        </>
        ) : (
          <>
            {renderConfigSectionCard({
              sectionKey: isFileDb ? "fileTarget" : "target",
              icon: isFileDb ? <FileTextOutlined /> : <GatewayOutlined />,
              children: (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) 120px",
                    gap: 16,
                    alignItems: "start",
                  }}
                >
                  <Form.Item
                    name="host"
                    label={
                      isFileDb
                        ? t("connection.modal.field.filePath.label")
                        : t("connection.modal.field.host.label")
                    }
                    rules={[
                      createUriAwareRequiredRule(
                        t("connection.modal.field.addressPath.required"),
                      ),
                    ]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      {...noAutoCapInputProps}
                      placeholder={
                        isFileDb
                          ? dbType === "duckdb"
                            ? "/path/to/db.duckdb"
                            : "/path/to/db.sqlite"
                          : "localhost"
                      }
                    />
                  </Form.Item>
                  {isFileDb ? (
                    <Form.Item label=" " style={{ marginBottom: 0 }}>
                      <Button
                        style={{ width: "100%" }}
                        onClick={handleSelectDatabaseFile}
                        loading={selectingDbFile}
                      >
                        {t("connection.modal.action.browse")}
                      </Button>
                    </Form.Item>
                  ) : (
                    <Form.Item
                      name="port"
                      label={t("connection.modal.field.port.label")}
                      rules={[
                        createUriAwareRequiredRule(
                          t("connection.modal.field.port.required"),
                          (value: unknown) => Number(value) > 0,
                        ),
                      ]}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber style={{ width: "100%" }} />
                    </Form.Item>
                  )}
                </div>
              ),
            })}

            {dbType === "clickhouse" &&
              renderConfigSectionCard({
                sectionKey: "connectionMode",
                icon: <ClusterOutlined />,
                children: (
                  <Form.Item
                    name="clickHouseProtocol"
                    label={t("connection.modal.field.protocol.label")}
                    help={t("connection.modal.field.clickHouseProtocol.help")}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      options={CLICKHOUSE_PROTOCOL_OPTIONS.map((option) => ({
                        ...option,
                        label: option.labelKey
                          ? t(option.labelKey)
                          : option.label,
                      }))}
                      onChange={() => clearConnectionTestResultForChoice()}
                    />
                  </Form.Item>
                ),
              })}

            {dbType === "oceanbase" &&
              renderConfigSectionCard({
                sectionKey: "oceanBaseProtocol",
                icon: <ClusterOutlined />,
                children: (
                  <Form.Item
                    name="oceanBaseProtocol"
                    label={t("connection.modal.field.oceanBaseProtocol.label")}
                    help={
                      <span>
                        {t(
                          "connection.modal.field.oceanBaseProtocol.help.primary",
                        )}
                        <br />
                        {t(
                          "connection.modal.field.oceanBaseProtocol.help.connectionAttributes",
                          {
                            attributes:
                              "connectionAttributes=key1:value1,key2:value2",
                          },
                        )}
                      </span>
                    }
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      options={OCEANBASE_PROTOCOL_OPTIONS}
                      onChange={() => {
                        form.setFieldsValue({ mysqlTopology: "single" });
                        clearConnectionTestResultForChoice();
                      }}
                    />
                  </Form.Item>
                ),
              })}

            {(dbType === "postgres" ||
              dbType === "kingbase" ||
              dbType === "highgo" ||
              dbType === "vastbase" ||
              dbType === "opengauss" ||
              dbType === "gaussdb" ||
              dbType === "trino") &&
              renderConfigSectionCard({
                sectionKey: "service",
                icon: <DatabaseOutlined />,
                children: (
                  <Form.Item
                    name="database"
                    label={t("connection.modal.field.defaultDatabase.label")}
                    help={t("connection.modal.field.defaultDatabase.help")}
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      {...noAutoCapInputProps}
                      placeholder={t(
                        "connection.modal.field.defaultDatabase.placeholder",
                      )}
                    />
                  </Form.Item>
                ),
              })}

            {dbType === "kafka" &&
              renderConfigSectionCard({
                sectionKey: "service",
                icon: <DatabaseOutlined />,
                children: (
                  <Form.Item
                    name="database"
                    label={t("connection.modal.messageQueue.kafka.defaultTopic.label")}
                    help={t("connection.modal.messageQueue.kafka.defaultTopic.help")}
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      {...noAutoCapInputProps}
                      placeholder={t(
                        "connection.modal.messageQueue.kafka.defaultTopic.placeholder",
                      )}
                    />
                  </Form.Item>
                ),
              })}

            {dbType === "rocketmq" &&
              renderConfigSectionCard({
                sectionKey: "service",
                icon: <DatabaseOutlined />,
                children: (
                  <Form.Item
                    name="database"
                    label={t("connection.modal.messageQueue.rocketmq.defaultTopic.label")}
                    help={t("connection.modal.messageQueue.rocketmq.defaultTopic.help")}
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      {...noAutoCapInputProps}
                      placeholder={t(
                        "connection.modal.messageQueue.rocketmq.defaultTopic.placeholder",
                      )}
                    />
                  </Form.Item>
                ),
              })}

            {dbType === "mqtt" &&
              renderConfigSectionCard({
                sectionKey: "service",
                icon: <DatabaseOutlined />,
                children: (
                  <Form.Item
                    name="database"
                    label={t("connection.modal.messageQueue.mqtt.defaultTopicFilter.label")}
                    help={t("connection.modal.messageQueue.mqtt.defaultTopicFilter.help")}
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      {...noAutoCapInputProps}
                      placeholder={t(
                        "connection.modal.messageQueue.mqtt.defaultTopicFilter.placeholder",
                      )}
                    />
                  </Form.Item>
                ),
              })}

            {dbType === "rabbitmq" &&
              renderConfigSectionCard({
                sectionKey: "service",
                icon: <DatabaseOutlined />,
                children: (
                  <Form.Item
                    name="database"
                    label={t("connection.modal.messageQueue.rabbitmq.defaultVirtualHost.label")}
                    help={t("connection.modal.messageQueue.rabbitmq.defaultVirtualHost.help")}
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      {...noAutoCapInputProps}
                      placeholder={t(
                        "connection.modal.messageQueue.rabbitmq.defaultVirtualHost.placeholder",
                      )}
                    />
                  </Form.Item>
                ),
              })}

            {(dbType === "oracle" || isOceanBaseOracle) &&
              renderConfigSectionCard({
                sectionKey: "service",
                icon: <DatabaseOutlined />,
                children: (
                  <Form.Item
                    name="database"
                    label={
                      isOceanBaseOracle
                        ? t(
                            "connection.modal.field.oceanBaseServiceName.label",
                          )
                        : t("connection.modal.field.serviceName.label")
                    }
                    rules={
                      isOceanBaseOracle
                        ? []
                        : [
                            createUriAwareRequiredRule(
                              t("connection.modal.field.serviceName.required"),
                            ),
                          ]
                    }
                    help={
                      isOceanBaseOracle
                        ? t(
                            "connection.modal.field.oceanBaseServiceName.help",
                          )
                        : t("connection.modal.field.serviceName.help")
                    }
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      {...noAutoCapInputProps}
                      placeholder={t(
                        "connection.modal.field.serviceName.placeholder",
                      )}
                    />
                  </Form.Item>
                ),
              })}

            {showConnectionReadOnlyField &&
              renderConfigSectionCard({
                sectionKey: "readOnly",
                icon: <SafetyCertificateOutlined />,
                collapsible: true,
                expanded: readOnlyProtectionExpanded,
                onToggle: () =>
                  setReadOnlyProtectionExpanded((expanded) => !expanded),
                badge: (
                  <Tag
                    color={
                      connectionProtectionEnabledCount > 0 ? "red" : "default"
                    }
                  >
                    {connectionProtectionEnabledCount > 0
                      ? t(
                          "connection.modal.field.readOnly.status.enabledCount",
                          {
                            count: connectionProtectionEnabledCount,
                          },
                        )
                      : t("connection.modal.field.readOnly.status.disabled")}
                  </Tag>
                ),
                children: (
                  <div style={{ display: "grid", gap: 14 }}>
                    <div
                      style={{
                        padding: 16,
                        borderRadius: 16,
                        border: connectionProtectionEnabledCount > 0
                          ? darkMode
                            ? "1px solid rgba(255,120,117,0.34)"
                            : "1px solid rgba(245,34,45,0.18)"
                          : darkMode
                            ? "1px solid rgba(255,214,102,0.24)"
                            : "1px solid rgba(250,173,20,0.18)",
                        background: connectionProtectionEnabledCount > 0
                          ? darkMode
                            ? "linear-gradient(180deg, rgba(255,120,117,0.12) 0%, rgba(255,120,117,0.05) 100%)"
                            : "linear-gradient(180deg, rgba(255,245,245,0.96) 0%, rgba(255,240,240,0.92) 100%)"
                          : darkMode
                            ? "linear-gradient(180deg, rgba(255,214,102,0.10) 0%, rgba(255,214,102,0.04) 100%)"
                            : "linear-gradient(180deg, rgba(255,251,230,0.98) 0%, rgba(255,247,214,0.94) 100%)",
                        boxShadow: darkMode
                          ? "inset 0 1px 0 rgba(255,255,255,0.04)"
                          : "inset 0 1px 0 rgba(255,255,255,0.92)",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: 16,
                          alignItems: "start",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 700,
                              color: darkMode ? "#f5f7ff" : "#162033",
                            }}
                          >
                            {t("connection.modal.field.readOnly.label")}
                          </div>
                          <div style={{ ...modalMutedTextStyle, marginTop: 6 }}>
                            {t("connection.modal.field.readOnly.help")}
                          </div>
                        </div>
                        <Text
                          style={{
                            fontSize: 12,
                            color: darkMode ? "#ffd591" : "#ad4e00",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t("connection.modal.field.readOnly.compatibility")}
                        </Text>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 12,
                      }}
                    >
                      {[
                        {
                          field: "restrictDataEdit",
                          checked: restrictDataEdit,
                          label: t(
                            "connection.modal.field.readOnly.option.dataEdit.label",
                          ),
                          help: t(
                            "connection.modal.field.readOnly.option.dataEdit.help",
                          ),
                        },
                        {
                          field: "restrictStructureEdit",
                          checked: restrictStructureEdit,
                          label: t(
                            "connection.modal.field.readOnly.option.structureEdit.label",
                          ),
                          help: t(
                            "connection.modal.field.readOnly.option.structureEdit.help",
                          ),
                        },
                        {
                          field: "restrictScriptExecution",
                          checked: restrictScriptExecution,
                          label: t(
                            "connection.modal.field.readOnly.option.scriptExecution.label",
                          ),
                          help: t(
                            "connection.modal.field.readOnly.option.scriptExecution.help",
                          ),
                        },
                        {
                          field: "restrictDataImport",
                          checked: restrictDataImport,
                          label: t(
                            "connection.modal.field.readOnly.option.dataImport.label",
                          ),
                          help: t(
                            "connection.modal.field.readOnly.option.dataImport.help",
                          ),
                        },
                      ].map((item) => (
                        <div
                          key={item.field}
                          onClick={() =>
                            setChoiceFieldValue(item.field, !item.checked)
                          }
                          style={{
                            padding: 14,
                            borderRadius: 14,
                            border: item.checked
                              ? darkMode
                                ? "1px solid rgba(255,120,117,0.22)"
                                : "1px solid rgba(245,34,45,0.14)"
                              : darkMode
                                ? "1px solid rgba(255,255,255,0.08)"
                                : "1px solid rgba(5,5,5,0.08)",
                            background: item.checked
                              ? darkMode
                                ? "rgba(255,120,117,0.08)"
                                : "rgba(255,241,240,0.92)"
                              : darkMode
                                ? "rgba(255,255,255,0.02)"
                                : "rgba(255,255,255,0.9)",
                            cursor: "pointer",
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "auto minmax(0, 1fr)",
                              gap: 12,
                              alignItems: "start",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                paddingTop: 2,
                              }}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Form.Item
                                name={item.field}
                                valuePropName="checked"
                                noStyle
                              >
                                <Checkbox
                                  onChange={() =>
                                    clearConnectionTestResultForChoice()
                                  }
                                  style={{
                                    marginInlineStart: 0,
                                  }}
                                />
                              </Form.Item>
                            </div>
                            <div>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: darkMode ? "#f5f7ff" : "#162033",
                                }}
                              >
                                {item.label}
                              </div>
                              <div
                                style={{
                                  ...modalMutedTextStyle,
                                  marginTop: 6,
                                  whiteSpace: "normal",
                                }}
                              >
                                {item.help}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        border: darkMode
                          ? "1px solid rgba(82,196,26,0.22)"
                          : "1px solid rgba(82,196,26,0.18)",
                        background: darkMode
                          ? "rgba(82,196,26,0.08)"
                          : "rgba(246,255,237,0.92)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: darkMode ? "#f5f7ff" : "#162033",
                        }}
                      >
                        {t("connection.modal.field.readOnly.summary.title")}
                      </div>
                      <div style={{ ...modalMutedTextStyle, marginTop: 6 }}>
                        {connectionProtectionEnabledCount > 0
                          ? t(
                              "connection.modal.field.readOnly.summary.selected",
                              { count: connectionProtectionEnabledCount },
                            )
                          : t(
                              "connection.modal.field.readOnly.summary.empty",
                            )}
                      </div>
                    </div>
                    <div
                      style={{
                        ...modalMutedTextStyle,
                        fontSize: 12,
                        lineHeight: 1.7,
                        padding: "0 4px",
                      }}
                    >
                      {t("connection.modal.field.readOnly.tip")}
                    </div>
                  </div>
                ),
              })}

            {isMySQLLike &&
              renderConfigSectionCard({
                sectionKey: "connectionMode",
                icon: <ClusterOutlined />,
                children: renderChoiceCards({
                  fieldName: "mysqlTopology",
                  value: String(mysqlTopology),
                  options: [
                    {
                      value: "single",
                      label: t("connection.modal.topology.single.label"),
                      description: t(
                        "connection.modal.topology.mysql.single.description",
                      ),
                    },
                    {
                      value: "replica",
                      label: t(
                        "connection.modal.topology.mysql.replica.label",
                      ),
                      description: t(
                        "connection.modal.topology.mysql.replica.description",
                      ),
                    },
                  ],
                }),
              })}

            {isKafka &&
              renderConfigSectionCard({
                sectionKey: "connectionMode",
                icon: <ClusterOutlined />,
                children: renderChoiceCards({
                  fieldName: "kafkaTopology",
                  value: String(kafkaTopology),
                  options: [
                    {
                      value: "single",
                      label: t("connection.modal.messageQueue.kafka.topology.single.label"),
                      description: t(
                        "connection.modal.messageQueue.kafka.topology.single.description",
                      ),
                    },
                    {
                      value: "cluster",
                      label: t("connection.modal.messageQueue.topology.cluster.label"),
                      description: t(
                        "connection.modal.messageQueue.kafka.topology.cluster.description",
                      ),
                    },
                  ],
                }),
              })}

            {isRocketMQ &&
              renderConfigSectionCard({
                sectionKey: "connectionMode",
                icon: <ClusterOutlined />,
                children: renderChoiceCards({
                  fieldName: "rocketmqTopology",
                  value: String(rocketmqTopology),
                  options: [
                    {
                      value: "single",
                      label: t("connection.modal.messageQueue.rocketmq.topology.single.label"),
                      description: t(
                        "connection.modal.messageQueue.rocketmq.topology.single.description",
                      ),
                    },
                    {
                      value: "cluster",
                      label: t("connection.modal.messageQueue.topology.cluster.label"),
                      description: t(
                        "connection.modal.messageQueue.rocketmq.topology.cluster.description",
                      ),
                    },
                  ],
                }),
              })}

            {isMQTT &&
              renderConfigSectionCard({
                sectionKey: "connectionMode",
                icon: <ClusterOutlined />,
                children: renderChoiceCards({
                  fieldName: "mqttTopology",
                  value: String(mqttTopology),
                  options: [
                    {
                      value: "single",
                      label: t("connection.modal.messageQueue.mqtt.topology.single.label"),
                      description: t(
                        "connection.modal.messageQueue.mqtt.topology.single.description",
                      ),
                    },
                    {
                      value: "cluster",
                      label: t("connection.modal.messageQueue.topology.cluster.label"),
                      description: t(
                        "connection.modal.messageQueue.mqtt.topology.cluster.description",
                      ),
                    },
                  ],
                }),
              })}

            {isKafka &&
              kafkaTopology === "cluster" &&
              renderConfigSectionCard({
                sectionKey: "replica",
                icon: <ClusterOutlined />,
                children: (
                  <Form.Item
                    name="kafkaHosts"
                    label={t("connection.modal.messageQueue.kafka.extraBrokers.label")}
                    help={t("connection.modal.messageQueue.kafka.extraBrokers.help")}
                  >
                    <Select
                      mode="tags"
                      placeholder={t(
                        "connection.modal.messageQueue.kafka.extraBrokers.placeholder",
                      )}
                      tokenSeparators={[",", ";", " "]}
                    />
                  </Form.Item>
                ),
              })}

            {isRocketMQ &&
              rocketmqTopology === "cluster" &&
              renderConfigSectionCard({
                sectionKey: "replica",
                icon: <ClusterOutlined />,
                children: (
                  <Form.Item
                    name="rocketmqHosts"
                    label={t("connection.modal.messageQueue.rocketmq.extraNameServers.label")}
                    help={t("connection.modal.messageQueue.rocketmq.extraNameServers.help")}
                  >
                    <Select
                      mode="tags"
                      placeholder={t(
                        "connection.modal.messageQueue.rocketmq.extraNameServers.placeholder",
                      )}
                      tokenSeparators={[",", ";", " "]}
                    />
                  </Form.Item>
                ),
              })}

            {isMQTT &&
              mqttTopology === "cluster" &&
              renderConfigSectionCard({
                sectionKey: "replica",
                icon: <ClusterOutlined />,
                children: (
                  <Form.Item
                    name="mqttHosts"
                    label={t("connection.modal.messageQueue.mqtt.extraBrokers.label")}
                    help={t("connection.modal.messageQueue.mqtt.extraBrokers.help")}
                  >
                    <Select
                      mode="tags"
                      placeholder={t(
                        "connection.modal.messageQueue.mqtt.extraBrokers.placeholder",
                      )}
                      tokenSeparators={[",", ";", " "]}
                    />
                  </Form.Item>
                ),
              })}

            {isMySQLLike &&
              mysqlTopology === "replica" &&
              renderConfigSectionCard({
                sectionKey: "replica",
                icon: <ClusterOutlined />,
                children: (
                  <>
                    <Form.Item
                      name="mysqlReplicaHosts"
                      label={t(
                        "connection.modal.field.mysqlReplicaHosts.label",
                      )}
                      help={t(
                        "connection.modal.field.mysqlReplicaHosts.help",
                      )}
                    >
                      <Select
                        mode="tags"
                        placeholder={t(
                          "connection.modal.field.mysqlReplicaHosts.placeholder",
                        )}
                        tokenSeparators={[",", ";", " "]}
                      />
                    </Form.Item>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 16,
                      }}
                    >
                      <Form.Item
                        name="mysqlReplicaUser"
                        label={t(
                          "connection.modal.field.mysqlReplicaUser.label",
                        )}
                        style={{ marginBottom: 0 }}
                      >
                        <Input
                          {...noAutoCapInputProps}
                          placeholder={t(
                            "connection.modal.field.mysqlReplicaUser.placeholder",
                          )}
                        />
                      </Form.Item>
                      <Form.Item
                        name="mysqlReplicaPassword"
                        label={t(
                          "connection.modal.field.mysqlReplicaPassword.label",
                        )}
                        style={{ marginBottom: 0 }}
                      >
                        <Input.Password
                          {...noAutoCapInputProps}
                          placeholder={getStoredSecretPlaceholder({
                            hasStoredSecret:
                              initialValues?.hasMySQLReplicaPassword,
                            emptyPlaceholder: t(
                              "connection.modal.field.mysqlReplicaPassword.placeholder",
                            ),
                            retainedLabel: t(
                              "connection.modal.field.mysqlReplicaPassword.retained",
                            ),
                          })}
                        />
                      </Form.Item>
                    </div>
                    {renderStoredSecretControls({
                      fieldName: "mysqlReplicaPassword",
                      clearKey: "mysqlReplicaPassword",
                      hasStoredSecret: initialValues?.hasMySQLReplicaPassword,
                      clearLabel: t(
                        "connection.modal.field.mysqlReplicaPassword.clear",
                      ),
                      description: t(
                        "connection.modal.field.mysqlReplicaPassword.savedDescription",
                      ),
                    })}
                  </>
                ),
              })}

            {dbType === "mongodb" &&
              renderConfigSectionCard({
                sectionKey: "connectionMode",
                icon: <ClusterOutlined />,
                children: renderChoiceCards({
                  fieldName: "mongoTopology",
                  value: String(mongoTopology),
                  options: [
                    {
                      value: "single",
                      label: t("connection.modal.topology.single.label"),
                      description: t(
                        "connection.modal.topology.mongodb.single.description",
                      ),
                    },
                    {
                      value: "replica",
                      label: t(
                        "connection.modal.topology.mongodb.replica.label",
                      ),
                      description: t(
                        "connection.modal.topology.mongodb.replica.description",
                      ),
                    },
                  ],
                }),
              })}

            {dbType === "mongodb" &&
              renderConfigSectionCard({
                sectionKey: "mongoDiscovery",
                icon: <ApiOutlined />,
                children: (
                  <>
                    <Form.Item name="mongoSrv" hidden valuePropName="checked">
                      <Checkbox />
                    </Form.Item>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(180px, 1fr))",
                        gap: 10,
                      }}
                    >
                      {[
                        {
                          value: false,
                          label: t(
                            "connection.modal.mongo.discovery.standard.label",
                          ),
                          description: t(
                            "connection.modal.mongo.discovery.standard.description",
                          ),
                        },
                        {
                          value: true,
                          label: t(
                            "connection.modal.mongo.discovery.srv.label",
                          ),
                          description: t(
                            "connection.modal.mongo.discovery.srv.description",
                          ),
                        },
                      ].map((option) => {
                        const active = mongoSrv === option.value;
                        return (
                          <button
                            key={String(option.value)}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              setChoiceFieldValue("mongoSrv", option.value)
                            }
                            style={{
                              textAlign: "left",
                              padding: "12px 14px",
                              borderRadius: 14,
                              border: active
                                ? darkMode
                                  ? "1px solid rgba(255,214,102,0.42)"
                                  : "1px solid rgba(22,119,255,0.36)"
                                : darkMode
                                  ? "1px solid rgba(255,255,255,0.08)"
                                  : "1px solid rgba(16,24,40,0.08)",
                              background: active
                                ? darkMode
                                  ? "rgba(255,214,102,0.10)"
                                  : "rgba(22,119,255,0.07)"
                                : darkMode
                                  ? "rgba(255,255,255,0.03)"
                                  : "rgba(16,24,40,0.03)",
                              color: darkMode ? "#f5f7ff" : "#162033",
                              cursor: "pointer",
                            }}
                          >
                            <Space size={8} wrap>
                              <Text strong>{option.label}</Text>
                              {active ? (
                                <Tag color="blue">
                                  {t("connection.modal.network.currentEditing")}
                                </Tag>
                              ) : null}
                            </Space>
                            <div
                              style={{
                                ...modalMutedTextStyle,
                                marginTop: 6,
                              }}
                            >
                              {option.description}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {mongoSrv && useSSH && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginTop: 12 }}
                        message={t(
                          "connection.modal.mongo.discovery.srvSshWarning",
                        )}
                      />
                    )}
                  </>
                ),
              })}

            {dbType === "mongodb" &&
              mongoTopology === "replica" &&
              renderConfigSectionCard({
                sectionKey: "replica",
                icon: <ClusterOutlined />,
                children: (
                  <>
                    <Form.Item
                      name="mongoHosts"
                      label={
                        mongoSrv
                          ? t("connection.modal.field.mongoSrvHosts.label")
                          : t("connection.modal.field.mongoHosts.label")
                      }
                      help={
                        mongoSrv
                          ? t("connection.modal.field.mongoSrvHosts.help")
                          : t("connection.modal.field.mongoHosts.help")
                      }
                    >
                      <Select
                        mode="tags"
                        placeholder={
                          mongoSrv
                            ? t(
                                "connection.modal.field.mongoSrvHosts.placeholder",
                              )
                            : t(
                                "connection.modal.field.mongoHosts.placeholder",
                              )
                        }
                        tokenSeparators={[",", ";", " "]}
                      />
                    </Form.Item>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 16,
                      }}
                    >
                      <Form.Item
                        name="mongoReplicaSet"
                        label={t(
                          "connection.modal.field.mongoReplicaSet.label",
                        )}
                        style={{ marginBottom: 0 }}
                      >
                        <Input
                          {...noAutoCapInputProps}
                          placeholder={t(
                            "connection.modal.field.mongoReplicaSet.placeholder",
                          )}
                        />
                      </Form.Item>
                      <Form.Item
                        name="mongoReplicaUser"
                        label={t(
                          "connection.modal.field.mongoReplicaUser.label",
                        )}
                        style={{ marginBottom: 0 }}
                      >
                        <Input
                          {...noAutoCapInputProps}
                          placeholder={t(
                            "connection.modal.field.mongoReplicaUser.placeholder",
                          )}
                        />
                      </Form.Item>
                    </div>
                    <Form.Item
                      name="mongoReplicaPassword"
                      label={t(
                        "connection.modal.field.mongoReplicaPassword.label",
                      )}
                      style={{ marginTop: 16, marginBottom: 0 }}
                    >
                      <Input.Password
                        {...noAutoCapInputProps}
                        placeholder={getStoredSecretPlaceholder({
                          hasStoredSecret:
                            initialValues?.hasMongoReplicaPassword,
                          emptyPlaceholder: t(
                            "connection.modal.field.mongoReplicaPassword.placeholder",
                          ),
                          retainedLabel: t(
                            "connection.modal.field.mongoReplicaPassword.retained",
                          ),
                        })}
                      />
                    </Form.Item>
                    {renderStoredSecretControls({
                      fieldName: "mongoReplicaPassword",
                      clearKey: "mongoReplicaPassword",
                      hasStoredSecret: initialValues?.hasMongoReplicaPassword,
                      clearLabel: t(
                        "connection.modal.field.mongoReplicaPassword.clear",
                      ),
                      description: t(
                        "connection.modal.field.mongoReplicaPassword.savedDescription",
                      ),
                    })}
                    <Space
                      size={8}
                      style={{ marginTop: 12, marginBottom: 12 }}
                    >
                      <Button
                        onClick={handleDiscoverMongoMembers}
                        loading={discoveringMembers}
                      >
                        {t("connection.modal.mongo.discoverMembers")}
                      </Button>
                    </Space>
                    {mongoMembers.length > 0 && (
                      <Table
                        size="small"
                        rowKey={(record) => record.host}
                        pagination={false}
                        dataSource={mongoMembers}
                        style={{ marginBottom: 12 }}
                        columns={[
                          {
                            title: t("connection.modal.field.host.label"),
                            dataIndex: "host",
                            width: "48%",
                          },
                          {
                            title: t("connection.modal.mongo.member.role"),
                            dataIndex: "role",
                            width: "32%",
                            render: (
                              value: string,
                              record: MongoMemberInfo,
                            ) => (
                              <Tag
                                color={record.isSelf ? "blue" : "default"}
                              >
                                {value ||
                                  record.state ||
                                  t("common.unknown")}
                              </Tag>
                            ),
                          },
                          {
                            title: t("connection.modal.mongo.member.health"),
                            dataIndex: "healthy",
                            width: "20%",
                            render: (value: boolean) => (
                              <Tag color={value ? "success" : "error"}>
                                {value
                                  ? t("connection.modal.mongo.member.healthy")
                                  : t(
                                      "connection.modal.mongo.member.unhealthy",
                                    )}
                              </Tag>
                            ),
                          },
                        ]}
                      />
                    )}
                  </>
                ),
              })}

            {dbType === "mongodb" &&
              renderConfigSectionCard({
                sectionKey: "mongoPolicy",
                icon: <ThunderboltOutlined />,
                children: (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 16,
                    }}
                  >
                    <Form.Item
                      name="mongoAuthSource"
                      label={t(
                        "connection.modal.field.mongoAuthSource.label",
                      )}
                      style={{ marginBottom: 0 }}
                    >
                      <Input
                        {...noAutoCapInputProps}
                        placeholder={t(
                          "connection.modal.field.mongoAuthSource.placeholder",
                        )}
                      />
                    </Form.Item>
                    <div style={{ display: "grid", gap: 8 }}>
                      <Text strong>
                        {t("connection.modal.mongo.readPreference.label")}
                      </Text>
                      {renderChoiceCards({
                        fieldName: "mongoReadPreference",
                        value: String(mongoReadPreference),
                        minWidth: 130,
                        options: [
                          {
                            value: "primary",
                            label: "primary",
                            description: t(
                              "connection.modal.mongo.readPreference.primary.description",
                            ),
                          },
                          {
                            value: "primaryPreferred",
                            label: "primaryPreferred",
                            description: t(
                              "connection.modal.mongo.readPreference.primaryPreferred.description",
                            ),
                          },
                          {
                            value: "secondary",
                            label: "secondary",
                            description: t(
                              "connection.modal.mongo.readPreference.secondary.description",
                            ),
                          },
                          {
                            value: "secondaryPreferred",
                            label: "secondaryPreferred",
                            description: t(
                              "connection.modal.mongo.readPreference.secondaryPreferred.description",
                            ),
                          },
                          {
                            value: "nearest",
                            label: "nearest",
                            description: t(
                              "connection.modal.mongo.readPreference.nearest.description",
                            ),
                          },
                        ],
                      })}
                    </div>
                  </div>
                ),
              })}

            {isRedis &&
              renderConfigSectionCard({
                sectionKey: "connectionMode",
                icon: <ClusterOutlined />,
                children: (
                  <>
                    {renderChoiceCards({
                      fieldName: "redisTopology",
                      value: String(redisTopology),
                      options: [
                        {
                          value: "single",
                          label: t("connection.modal.topology.single.label"),
                          description: t(
                            "connection.modal.topology.redis.single.description",
                          ),
                        },
                        {
                          value: "cluster",
                          label: t(
                            "connection.modal.topology.redis.cluster.label",
                          ),
                          description: t(
                            "connection.modal.topology.redis.cluster.description",
                          ),
                        },
                      ],
                    })}
                    {redisTopology === "cluster" && (
                      <Form.Item
                        name="redisHosts"
                        label={t("connection.modal.field.redisHosts.label")}
                        help={t("connection.modal.field.redisHosts.help")}
                        style={{ marginTop: 16, marginBottom: 0 }}
                      >
                        <Select
                          mode="tags"
                          placeholder={t(
                            "connection.modal.field.redisHosts.placeholder",
                          )}
                          tokenSeparators={[",", ";", " "]}
                        />
                      </Form.Item>
                    )}
                  </>
                ),
              })}

            {isRedis &&
              renderConfigSectionCard({
                sectionKey: "credentials",
                icon: <SafetyCertificateOutlined />,
                children: (
                  <>
                    <Form.Item
                      name="password"
                      label={t("connection.modal.field.redisPassword.label")}
                    >
                      <Input.Password
                        {...noAutoCapInputProps}
                        visibilityToggle={{
                          visible: primaryPasswordVisible,
                          onVisibleChange: setPrimaryPasswordVisible,
                        }}
                        placeholder={getStoredSecretPlaceholder({
                          hasStoredSecret: initialValues?.hasPrimaryPassword,
                          emptyPlaceholder: t(
                            "connection.modal.field.redisPassword.placeholder",
                          ),
                          retainedLabel: t(
                            "connection.modal.field.redisPassword.retained",
                          ),
                        })}
                      />
                    </Form.Item>
                  </>
                ),
              })}

            {isRedis &&
              renderConfigSectionCard({
                sectionKey: "databaseScope",
                icon: <DatabaseOutlined />,
                children: (
                  <Form.Item
                    name="includeRedisDatabases"
                    label={t(
                      "connection.modal.field.displayDatabases.label",
                    )}
                    help={t("connection.modal.field.displayDatabases.help")}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      mode="multiple"
                      placeholder={t(
                        "connection.modal.field.displayRedisDatabases.placeholder",
                      )}
                      allowClear
                    >
                      {redisDbList.map((db: number) => (
                        <Select.Option key={db} value={db}>
                          db{db}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                ),
              })}

            {!isFileDb &&
              !isRedis &&
              renderConfigSectionCard({
                sectionKey: "credentials",
                icon: <SafetyCertificateOutlined />,
                children: (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          dbType === "mongodb"
                            ? "minmax(0, 1fr) minmax(0, 1fr) 180px"
                            : "repeat(2, minmax(0, 1fr))",
                        gap: 16,
                      }}
                    >
                      <Form.Item
                        name="user"
                        label={t("connection.modal.field.username.label")}
                        rules={
                          PRIMARY_USERNAME_OPTIONAL_TYPES.has(dbType)
                            ? []
                            : [
                                createUriAwareRequiredRule(
                                  t(
                                    "connection.modal.field.username.required",
                                  ),
                                ),
                              ]
                        }
                        style={{ marginBottom: 0 }}
                      >
                        <Input
                          {...noAutoCapInputProps}
                          placeholder={
                            PRIMARY_USERNAME_OPTIONAL_TYPES.has(dbType)
                              ? t("connection.modal.field.username.optional_placeholder")
                              : undefined
                          }
                        />
                      </Form.Item>
                      <Form.Item
                        name="password"
                        label={t("connection.modal.field.password.label")}
                        style={{ marginBottom: 0 }}
                      >
                        <Input.Password
                          {...noAutoCapInputProps}
                          visibilityToggle={{
                            visible: primaryPasswordVisible,
                            onVisibleChange: setPrimaryPasswordVisible,
                          }}
                          placeholder={getStoredSecretPlaceholder({
                            hasStoredSecret:
                              initialValues?.hasPrimaryPassword,
                            emptyPlaceholder: t(
                              "connection.modal.field.password.placeholder",
                            ),
                            retainedLabel: t(
                              "connection.modal.field.password.retained",
                            ),
                          })}
                        />
                      </Form.Item>
                      {dbType === "mongodb" && (
                        <div style={{ display: "grid", gap: 8 }}>
                          <Text strong>
                            {t(
                              "connection.modal.mongo.authMechanism.label",
                            )}
                          </Text>
                          {renderChoiceCards({
                            fieldName: "mongoAuthMechanism",
                            value: String(mongoAuthMechanism),
                            minWidth: 150,
                            options: [
                              {
                                value: "",
                                label: t(
                                  "connection.modal.mongo.authMechanism.auto.label",
                                ),
                                description: t(
                                  "connection.modal.mongo.authMechanism.auto.description",
                                ),
                              },
                              {
                                value: "NONE",
                                label: t(
                                  "connection.modal.mongo.authMechanism.none.label",
                                ),
                                description: t(
                                  "connection.modal.mongo.authMechanism.none.description",
                                ),
                              },
                              {
                                value: "SCRAM-SHA-1",
                                label: "SCRAM-SHA-1",
                                description: t(
                                  "connection.modal.mongo.authMechanism.scramSha1.description",
                                ),
                              },
                              {
                                value: "SCRAM-SHA-256",
                                label: "SCRAM-SHA-256",
                                description: t(
                                  "connection.modal.mongo.authMechanism.scramSha256.description",
                                ),
                              },
                              {
                                value: "MONGODB-AWS",
                                label: "MONGODB-AWS",
                                description: t(
                                  "connection.modal.mongo.authMechanism.aws.description",
                                ),
                              },
                            ],
                          })}
                        </div>
                      )}
                    </div>
                    {dbType === "mongodb" && (
                      <Form.Item
                        name="savePassword"
                        valuePropName="checked"
                        style={{ marginTop: 12, marginBottom: 0 }}
                      >
                        <Checkbox>
                          {t("connection.modal.field.savePassword")}
                        </Checkbox>
                      </Form.Item>
                    )}
                  </>
                ),
              })}

            {!isFileDb &&
              !isRedis &&
              !isKafka &&
              renderConfigSectionCard({
                sectionKey: "databaseScope",
                icon: <DatabaseOutlined />,
                children: (
                  <Form.Item
                    name="includeDatabases"
                    label={t(
                      "connection.modal.field.displayDatabases.label",
                    )}
                    help={t("connection.modal.field.displayDatabases.help")}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      mode="multiple"
                      placeholder={t(
                        "connection.modal.field.displayDatabases.placeholder",
                      )}
                      allowClear
                    >
                      {dbList.map((db: string) => (
                        <Select.Option key={db} value={db}>
                          {db}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                ),
              })}
          </>
        )}
      </div>
    </div>
  );

  const networkSecuritySection = (
    <ConnectionModalNetworkSecuritySection
      activeNetworkConfig={activeNetworkConfig}
      darkMode={darkMode}
      dbType={dbType}
      form={form}
      getConnectionOptionCardStyle={getConnectionOptionCardStyle}
      handleSelectCertificateFile={handleSelectCertificateFile}
      handleSelectSSHKeyFile={handleSelectSSHKeyFile}
      initialValues={initialValues}
      isFileDb={isFileDb}
      isJVM={isJVM}
      isSSLType={isSSLType}
      modalInnerSectionStyle={modalInnerSectionStyle}
      modalMutedTextStyle={modalMutedTextStyle}
      renderChoiceCards={renderChoiceCards}
      renderStoredSecretControls={renderStoredSecretControls}
      proxyType={proxyType}
      selectingCertificateField={selectingCertificateField}
      selectingSSHKey={selectingSSHKey}
      setActiveNetworkConfig={setActiveNetworkConfig}
      sslHintText={sslHintText}
      sslMode={sslMode}
      supportsSSLCAPath={supportsSSLCAPath}
      supportsSSLClientCertificate={supportsSSLClientCertificate}
      tunnelSectionStyle={tunnelSectionStyle}
      useHttpTunnel={useHttpTunnel}
      useProxy={useProxy}
      useSSH={useSSH}
      useSSL={useSSL}
    />
  );

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        type: "mysql",
        host: "localhost",
        port: 3306,
        database: "",
        user: "root",
        useSSL: false,
        sslMode: "preferred",
        sslCAPath: "",
        sslCertPath: "",
        sslKeyPath: "",
        useSSH: false,
        sshPort: 22,
        useProxy: false,
        proxyType: "socks5",
        proxyPort: 1080,
        useHttpTunnel: false,
        httpTunnelPort: 8080,
        timeout: 30,
        keepAliveEnabled: false,
        keepAliveIntervalMinutes: 240,
        keepAliveSQL: "",
        uri: "",
        connectionParams: "",
        restrictDataEdit: false,
        restrictStructureEdit: false,
        restrictScriptExecution: false,
        restrictDataImport: false,
        oceanBaseProtocol: "mysql",
        mysqlTopology: "single",
        rocketmqTopology: "single",
        mqttTopology: "single",
        kafkaTopology: "single",
        redisTopology: "single",
        mongoTopology: "single",
        mongoSrv: false,
        mongoReadPreference: "primary",
        mongoAuthMechanism: "",
        savePassword: true,
        mysqlReplicaHosts: [],
        rocketmqHosts: [],
        mqttHosts: [],
        kafkaHosts: [],
        redisHosts: [],
        redisSentinelMaster: "",
        redisSentinelUser: "",
        redisSentinelPassword: "",
        mongoHosts: [],
        mysqlReplicaUser: "",
        mysqlReplicaPassword: "",
        mongoReplicaUser: "",
        mongoReplicaPassword: "",
        redisDB: 0,
        jvmReadOnly: true,
        jvmAllowedModes: ["jmx"],
        jvmPreferredMode: "jmx",
        jvmEnvironment: "dev",
        jvmEndpointEnabled: false,
        jvmEndpointBaseUrl: "",
        jvmEndpointApiKey: "",
        jvmAgentEnabled: false,
        jvmAgentBaseUrl: "",
        jvmAgentApiKey: "",
        jvmDiagnosticEnabled: false,
        jvmDiagnosticTransport: "agent-bridge",
        jvmDiagnosticBaseUrl: "",
        jvmDiagnosticTargetId: "",
        jvmDiagnosticApiKey: "",
        jvmDiagnosticAllowObserveCommands: true,
        jvmDiagnosticAllowTraceCommands: false,
        jvmDiagnosticAllowMutatingCommands: false,
        jvmDiagnosticTimeoutSeconds: 15,
        jvmEndpointTimeoutSeconds: 30,
        jvmJmxHost: "",
        jvmJmxPort: undefined,
        jvmJmxUsername: "",
        jvmJmxPassword: "",
      }}
      onValuesChange={(changed) => {
        if (testResult) {
          setTestResult(null);
          setTestErrorLogOpen(false);
        }
        if (
          changed.uri !== undefined ||
          changed.connectionParams !== undefined ||
          changed.type !== undefined ||
          changed.oceanBaseProtocol !== undefined
        ) {
          setUriFeedback(null);
        }
        if (changed.useSSL !== undefined) {
          setUseSSL(changed.useSSL);
          if (changed.useSSL) setActiveNetworkConfig("ssl");
        }
        if (changed.useSSH !== undefined) {
          setUseSSH(changed.useSSH);
          if (changed.useSSH) setActiveNetworkConfig("ssh");
        }
        if (changed.useProxy !== undefined) {
          const enabledProxy = !!changed.useProxy;
          setUseProxy(enabledProxy);
          if (enabledProxy) setActiveNetworkConfig("proxy");
          if (enabledProxy && form.getFieldValue("useHttpTunnel")) {
            form.setFieldValue("useHttpTunnel", false);
            setUseHttpTunnel(false);
          }
        }
        if (changed.proxyType !== undefined) {
          const nextType = String(
            changed.proxyType || "socks5",
          ).toLowerCase();
          if (nextType === "http") {
            const currentPort = Number(form.getFieldValue("proxyPort") || 0);
            if (!currentPort || currentPort === 1080) {
              form.setFieldValue("proxyPort", 8080);
            }
          } else {
            const currentPort = Number(form.getFieldValue("proxyPort") || 0);
            if (!currentPort || currentPort === 8080) {
              form.setFieldValue("proxyPort", 1080);
            }
          }
        }
        if (changed.useHttpTunnel !== undefined) {
          const enabledHttpTunnel = !!changed.useHttpTunnel;
          setUseHttpTunnel(enabledHttpTunnel);
          if (enabledHttpTunnel) setActiveNetworkConfig("httpTunnel");
          if (enabledHttpTunnel && form.getFieldValue("useProxy")) {
            form.setFieldValue("useProxy", false);
            setUseProxy(false);
          }
          if (enabledHttpTunnel) {
            const currentPort = Number(
              form.getFieldValue("httpTunnelPort") || 0,
            );
            if (!currentPort || currentPort <= 0) {
              form.setFieldValue("httpTunnelPort", 8080);
            }
          }
        }
        if (changed.type !== undefined) setDbType(changed.type);
        if (changed.jvmAllowedModes !== undefined) {
          const resolvedModes = normalizeEditableJVMModes(
            changed.jvmAllowedModes,
          );
          const currentPreferredMode = String(
            form.getFieldValue("jvmPreferredMode") || "",
          )
            .trim()
            .toLowerCase();
          const resolvedPreferredMode =
            resolvedModes.find((mode) => mode === currentPreferredMode) ||
            resolvedModes[0];
          form.setFieldValue("jvmAllowedModes", resolvedModes);
          form.setFieldValue("jvmPreferredMode", resolvedPreferredMode);
          form.setFieldValue(
            "jvmEndpointEnabled",
            resolvedModes.includes("endpoint"),
          );
          form.setFieldValue(
            "jvmAgentEnabled",
            resolvedModes.includes("agent"),
          );
        }
        if (changed.redisTopology !== undefined) {
          const nextRedisTopology = String(
            changed.redisTopology || "single",
          ).toLowerCase();
          const currentRedisPort = Number(form.getFieldValue("port") || 0);
          if (
            nextRedisTopology === "sentinel" &&
            (!currentRedisPort || currentRedisPort === 6379)
          ) {
            form.setFieldValue("port", 26379);
          } else if (
            nextRedisTopology !== "sentinel" &&
            currentRedisPort === 26379
          ) {
            form.setFieldValue("port", 6379);
          }
          const supportedDbs = buildRedisDatabaseList(
            form.getFieldValue("redisDB"),
            form.getFieldValue("includeRedisDatabases"),
          );
          setRedisDbList(supportedDbs);
          form.setFieldValue(
            "includeRedisDatabases",
            normalizeRedisDatabaseSelection(
              form.getFieldValue("includeRedisDatabases"),
              supportedDbs,
            ),
          );
        }
        if (
          changed.type !== undefined ||
          changed.host !== undefined ||
          changed.port !== undefined ||
          changed.mongoHosts !== undefined ||
          changed.mongoTopology !== undefined ||
          changed.mongoSrv !== undefined
        ) {
          setMongoMembers([]);
        }
      }}
    >
      <Form.Item name="type" hidden>
        <Input {...noAutoCapInputProps} />
      </Form.Item>
      {currentDriverUnavailableReason && (
        <Alert
          showIcon
          type="warning"
          style={{ marginBottom: 12 }}
          message={t("connection.modal.driver.unavailableTitle", {
            name: currentDriverSnapshot?.name || dbType,
          })}
          description={
            <Space size={8}>
              <span>{currentDriverUnavailableReason}</span>
              <Button
                type="link"
                size="small"
                onClick={() => onOpenDriverManager?.()}
              >
                {t("connection.modal.driver.installAction")}
              </Button>
            </Space>
          }
        />
      )}
      {currentDriverUpdateReason && (
        <Alert
          showIcon
          type="warning"
          style={{ marginBottom: 12 }}
          message={t("connection.modal.driver.updateFallback", {
            name: currentDriverSnapshot?.name || dbType,
          })}
          description={
            <Space size={8}>
              <span>{currentDriverUpdateReason}</span>
              <Button
                type="link"
                size="small"
                onClick={() => onOpenDriverManager?.()}
              >
                {t("connection.modal.driver.reinstallAction")}
              </Button>
            </Space>
          }
        />
      )}
      {(() => {
        const sectionItems: Array<{
          key: "basic" | "network" | "appearance";
          title: string;
          description: string;
          icon: React.ReactNode;
        }> = [
          {
            key: "basic",
            title: t("connection.modal.config.basic.title"),
            description: isJVM
              ? t("connection.modal.config.basic.jvmNavDescription")
              : t("connection.modal.config.basic.navDescription"),
            icon: <DatabaseOutlined />,
          },
          ...(!isCustom && !isFileDb && !isJVM
            ? [
                {
                  key: "network" as const,
                  title: t("connection.modal.network.title"),
                  description: t(
                    "connection.modal.network.navDescription",
                  ),
                  icon: <CloudOutlined />,
                },
              ]
            : []),
          {
            key: "appearance",
            title: t("connection.modal.appearance.title"),
            description: t("connection.modal.appearance.description"),
            icon: <BgColorsOutlined />,
          },
        ];
        const resolvedSection = sectionItems.some(
          (item) => item.key === activeConfigSection,
        )
          ? activeConfigSection
          : sectionItems[0]?.key || "basic";

        const effectiveIconType = customIconType || dbType;
        const effectiveIconColor =
          customIconColor || getDbDefaultColor(effectiveIconType);

        const appearanceSection = (
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ ...modalInnerSectionStyle, padding: 16 }}>
              <div
                style={{
                  marginBottom: 12,
                  fontSize: 13,
                  fontWeight: 700,
                  color: darkMode ? "#f5f7ff" : "#162033",
                }}
              >
                {t("connection.modal.appearance.icon")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {DB_ICON_TYPES.map((iconKey) => {
                  const isActive = effectiveIconType === iconKey;
                  return (
                    <button
                      key={iconKey}
                      type="button"
                      title={getDbIconLabel(iconKey)}
                      onClick={() =>
                        setCustomIconType(
                          iconKey === dbType ? undefined : iconKey,
                        )
                      }
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        display: "grid",
                        placeItems: "center",
                        border: `2px solid ${isActive ? effectiveIconColor : darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
                        background: isActive
                          ? darkMode
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(24,144,255,0.06)"
                          : "transparent",
                        cursor: "pointer",
                        transition: "all 120ms ease",
                      }}
                    >
                      {getDbIcon(
                        iconKey,
                        isActive ? effectiveIconColor : undefined,
                        22,
                      )}
                    </button>
                  );
                })}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: darkMode
                    ? "rgba(255,255,255,0.45)"
                    : "rgba(0,0,0,0.35)",
                }}
              >
                {t("connection.modal.appearance.current", {
                  name: getDbIconLabel(effectiveIconType),
                })}
              </div>
            </div>
            <div style={{ ...modalInnerSectionStyle, padding: 16 }}>
              <div
                style={{
                  marginBottom: 12,
                  fontSize: 13,
                  fontWeight: 700,
                  color: darkMode ? "#f5f7ff" : "#162033",
                }}
              >
                {t("connection.modal.appearance.color")}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                {PRESET_ICON_COLORS.map((presetColor) => {
                  const isActive = effectiveIconColor === presetColor;
                  return (
                    <button
                      key={presetColor}
                      type="button"
                      onClick={() =>
                        setCustomIconColor(
                          presetColor === getDbDefaultColor(effectiveIconType)
                            ? undefined
                            : presetColor,
                        )
                      }
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: presetColor,
                        border: isActive
                          ? `2.5px solid ${darkMode ? "#fff" : "#162033"}`
                          : "2px solid transparent",
                        cursor: "pointer",
                        transition: "all 120ms ease",
                        boxShadow: isActive
                          ? `0 0 0 2px ${presetColor}40`
                          : "none",
                      }}
                    />
                  );
                })}
                <input
                  type="color"
                  value={effectiveIconColor}
                  onChange={(e) =>
                    setCustomIconColor(
                      e.target.value === getDbDefaultColor(effectiveIconType)
                        ? undefined
                        : e.target.value,
                    )
                  }
                  title={t("connection.modal.appearance.customColor")}
                  style={{
                    width: 28,
                    height: 28,
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    borderRadius: 6,
                    background: "transparent",
                  }}
                />
              </div>
            </div>
            <div
              style={{
                ...modalInnerSectionStyle,
                padding: 16,
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: darkMode ? "#f5f7ff" : "#162033",
                }}
              >
                {t("connection.modal.appearance.preview")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {getDbIcon(effectiveIconType, effectiveIconColor, 24)}
                <span
                  style={{
                    fontSize: 14,
                    color: darkMode ? "#e0e0e0" : "#333",
                  }}
                >
                  {form.getFieldValue("name") ||
                    t("connection.modal.appearance.previewName")}
                </span>
              </div>
              {(customIconType || customIconColor) && (
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    setCustomIconType(undefined);
                    setCustomIconColor(undefined);
                  }}
                >
                  {t("connection.modal.appearance.reset")}
                </Button>
              )}
            </div>
          </div>
        );

        const currentSectionContent =
          resolvedSection === "basic"
            ? baseInfoSection
            : resolvedSection === "appearance"
              ? appearanceSection
              : networkSecuritySection;

        if (sectionItems.length <= 1) {
          return currentSectionContent;
        }

        return (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "220px minmax(0, 1fr)",
              gap: 18,
              alignItems: "start",
            }}
          >
            <div
              style={{
                ...modalInnerSectionStyle,
                padding: 12,
                position: "sticky",
                top: 0,
              }}
            >
              <div
                style={{
                  marginBottom: 12,
                  color: darkMode ? "#f5f7ff" : "#162033",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 0.2,
                }}
              >
                {t("connection.modal.config.sections")}
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {sectionItems.map((item) => {
                  const active = item.key === resolvedSection;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setActiveConfigSection(item.key)}
                      style={{
                        textAlign: "left",
                        padding: "12px 12px 12px 14px",
                        borderRadius: 14,
                        border: `1px solid ${
                          active
                            ? darkMode
                              ? "rgba(255,214,102,0.3)"
                              : "rgba(24,144,255,0.24)"
                            : darkMode
                              ? "rgba(255,255,255,0.045)"
                              : "rgba(16,24,40,0.055)"
                        }`,
                        background: active
                          ? darkMode
                            ? "linear-gradient(180deg, rgba(255,214,102,0.12) 0%, rgba(255,214,102,0.06) 100%)"
                            : "linear-gradient(180deg, rgba(24,144,255,0.10) 0%, rgba(24,144,255,0.05) 100%)"
                          : darkMode
                            ? "rgba(255,255,255,0.02)"
                            : "rgba(255,255,255,0.7)",
                        color: active
                          ? darkMode
                            ? "#f5f7ff"
                            : "#162033"
                          : darkMode
                            ? "rgba(255,255,255,0.76)"
                            : "#3f4b5e",
                        cursor: "pointer",
                        transition: "all 120ms ease",
                        boxShadow: active
                          ? darkMode
                            ? "0 10px 24px rgba(0,0,0,0.18)"
                            : "0 10px 22px rgba(24,144,255,0.08)"
                          : "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 10,
                            display: "grid",
                            placeItems: "center",
                            flexShrink: 0,
                            background: active
                              ? darkMode
                                ? "rgba(255,214,102,0.16)"
                                : "rgba(24,144,255,0.14)"
                              : darkMode
                                ? "rgba(255,255,255,0.05)"
                                : "rgba(16,24,40,0.05)",
                            color: active
                              ? darkMode
                                ? "#ffd666"
                                : "#1677ff"
                              : darkMode
                                ? "rgba(255,255,255,0.55)"
                                : "#627089",
                          }}
                        >
                          {item.icon}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <span style={{ fontSize: 14, fontWeight: 700 }}>
                              {item.title}
                            </span>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 999,
                                background: active
                                  ? darkMode
                                    ? "#ffd666"
                                    : "#1677ff"
                                  : "transparent",
                                border: active
                                  ? "none"
                                  : darkMode
                                    ? "1px solid rgba(255,255,255,0.12)"
                                    : "1px solid rgba(16,24,40,0.12)",
                              }}
                            />
                          </div>
                          <div
                            style={{
                              marginTop: 5,
                              fontSize: 12,
                              lineHeight: 1.55,
                              color: active
                                ? darkMode
                                  ? "rgba(255,255,255,0.68)"
                                  : "rgba(22,32,51,0.68)"
                                : darkMode
                                  ? "rgba(255,255,255,0.42)"
                                  : "rgba(63,75,94,0.62)",
                            }}
                          >
                            {item.description}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ minWidth: 0 }}>{currentSectionContent}</div>
          </div>
        );
      })()}
    </Form>
  );
};

  return renderStep2();
};

export default ConnectionModalStep2;
