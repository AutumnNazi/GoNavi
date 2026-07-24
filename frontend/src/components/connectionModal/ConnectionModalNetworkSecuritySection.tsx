import React from "react";
import { Button, Checkbox, Form, Input, InputNumber, Space, Typography } from "antd";

import { t } from "../../i18n";
import { getStoredSecretPlaceholder } from "../../utils/connectionModalPresentation";
import { noAutoCapInputProps } from "../../utils/inputAutoCap";
import {
  isSingleReadOnlyConnectionQuery,
  MAX_CONNECTION_KEEPALIVE_SQL_LENGTH,
  supportsConnectionKeepAliveSQL,
} from "../../utils/connectionReadOnly";

const { Text } = Typography;
const DEFAULT_KEEPALIVE_INTERVAL_MINUTES = 240;
const MIN_KEEPALIVE_INTERVAL_MINUTES = 1;
const MAX_KEEPALIVE_INTERVAL_MINUTES = 1440;

type ConnectionModalNetworkSecuritySectionProps = Record<string, any>;

const ConnectionModalNetworkSecuritySection: React.FC<ConnectionModalNetworkSecuritySectionProps> = (props) => {
  const {
    activeNetworkConfig,
    darkMode,
    dbType,
    form,
    getConnectionOptionCardStyle,
    handleSelectCertificateFile,
    handleSelectSSHKeyFile,
    initialValues,
    isFileDb,
    isJVM,
    isSSLType,
    modalInnerSectionStyle,
    modalMutedTextStyle,
    renderChoiceCards,
    renderStoredSecretControls,
    proxyType,
    selectingCertificateField,
    selectingSSHKey,
    setActiveNetworkConfig,
    sslHintText,
    sslMode,
    supportsSSLCAPath,
    supportsSSLClientCertificate,
    tunnelSectionStyle,
    useHttpTunnel,
    useProxy,
    useSSH,
    useSSL,
  } = props;

  if (isFileDb || isJVM) {
    return null;
  }

  const effectiveUseSSL = useSSL || !!form.getFieldValue("useSSL");
  const effectiveUseSSH = useSSH || !!form.getFieldValue("useSSH");
  const effectiveUseHttpTunnel =
    useHttpTunnel ||
    !!form.getFieldValue("useHttpTunnel");
  const effectiveUseProxy =
    !effectiveUseHttpTunnel &&
    (useProxy || !!form.getFieldValue("useProxy"));
  const keepAliveEnabled = !!Form.useWatch("keepAliveEnabled", form);
  const connectionDriver = Form.useWatch("driver", form);
  const oceanBaseProtocol = Form.useWatch("oceanBaseProtocol", form);
  const keepAliveSQLSupported = supportsConnectionKeepAliveSQL({
    type: dbType,
    driver: connectionDriver,
    oceanBaseProtocol: oceanBaseProtocol,
  });
  const networkItems: Array<{
    key: "ssl" | "ssh" | "proxy" | "httpTunnel";
    title: string;
    description: string;
    enabled: boolean;
  }> = [
    ...(isSSLType
      ? [
          {
            key: "ssl" as const,
            title: t("connection.modal.network.ssl_tls"),
            description: t(
              "connection.modal.network.ssl.description",
            ),
            enabled: effectiveUseSSL,
          },
        ]
      : []),
    {
      key: "ssh",
      title: t("connection.modal.network.ssh.title"),
      description: t("connection.modal.network.ssh.description"),
      enabled: effectiveUseSSH,
    },
    {
      key: "proxy",
      title: t("connection.modal.network.proxy.title"),
      description: t("connection.modal.network.proxy.description"),
      enabled: effectiveUseProxy,
    },
    {
      key: "httpTunnel",
      title: t("connection.modal.network.httpTunnel.title"),
      description: t(
        "connection.modal.network.httpTunnel.description",
      ),
      enabled: effectiveUseHttpTunnel,
    },
  ];
  const resolvedNetworkConfig =
    activeNetworkConfig === "ssl" && !effectiveUseSSL
      ? networkItems.find((item) => item.enabled)?.key ||
        (networkItems.some((item) => item.key === activeNetworkConfig)
          ? activeNetworkConfig
          : networkItems[0]?.key || "ssh")
      : networkItems.some((item) => item.key === activeNetworkConfig)
        ? activeNetworkConfig
        : networkItems[0]?.key || "ssh";
  const renderNetworkPanel = () => {
    if (resolvedNetworkConfig === "ssl") {
      return (
        <div style={{ ...modalInnerSectionStyle, padding: 14 }}>
          <div
            style={{
              marginBottom: 8,
              color: darkMode ? "#f5f7ff" : "#162033",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {t("connection.modal.network.ssl_tls")}
          </div>
          <div style={{ ...modalMutedTextStyle, marginBottom: 14 }}>
            {t("connection.modal.network.ssl.panelDescription")}
          </div>
          {!effectiveUseSSL ? (
            <div
              style={{
                ...modalMutedTextStyle,
                padding: "10px 12px",
                borderRadius: 12,
                background: darkMode
                  ? "rgba(255,255,255,0.03)"
                  : "rgba(16,24,40,0.04)",
              }}
            >
              <div>{t("connection.modal.network.ssl.disabledHint")}</div>
              <div style={{ marginTop: 8 }}>{sslHintText}</div>
            </div>
          ) : (
            <div style={tunnelSectionStyle}>
              <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                <Text strong>
                  {t("connection.modal.network.ssl.mode")}
                </Text>
                {renderChoiceCards({
                  fieldName: "sslMode",
                  value: String(sslMode),
                  options: [
                    {
                      value: "preferred",
                      label: t(
                        "connection.modal.network.ssl_mode.preferred",
                      ),
                      description: t(
                        "connection.modal.network.ssl.preferred.description",
                      ),
                    },
                    {
                      value: "required",
                      label: t(
                        "connection.modal.network.ssl_mode.required",
                      ),
                      description: t(
                        "connection.modal.network.ssl.required.description",
                      ),
                    },
                    {
                      value: "skip-verify",
                      label: t(
                        "connection.modal.network.ssl_mode.skip_verify",
                      ),
                      description: t(
                        "connection.modal.network.ssl.skipVerify.description",
                      ),
                    },
                  ],
                })}
              </div>
              {(supportsSSLCAPath || supportsSSLClientCertificate) && (
                <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                  {supportsSSLCAPath && (
                    <Form.Item
                      label={
                        dbType === "sqlserver"
                          ? t(
                              "connection.modal.network.ssl.serverCaPath",
                            )
                          : t(
                              "connection.modal.network.ssl.caPath",
                            )
                      }
                      style={{ marginBottom: 0 }}
                    >
                      <Space.Compact style={{ width: "100%" }}>
                        <Form.Item name="sslCAPath" noStyle>
                          <Input
                            {...noAutoCapInputProps}
                            placeholder={t(
                              "connection.modal.example",
                              { value: "C:\\certs\\ca.pem" },
                            )}
                          />
                        </Form.Item>
                        <Button
                          onClick={() => handleSelectCertificateFile("sslCAPath", "ca")}
                          loading={selectingCertificateField === "sslCAPath"}
                        >
                          {t("connection.modal.action.browse")}
                        </Button>
                      </Space.Compact>
                    </Form.Item>
                  )}
                  {supportsSSLClientCertificate && (
                    <>
                      <Form.Item
                        label={
                          dbType === "dameng"
                            ? t(
                                "connection.modal.network.ssl.damengCertPath",
                              )
                            : t(
                                "connection.modal.network.ssl.certPath",
                              )
                        }
                        rules={[
                          {
                            required: dbType === "dameng",
                            message: t(
                              "connection.modal.network.ssl.certRequired",
                            ),
                          },
                        ]}
                        style={{ marginBottom: 0 }}
                      >
                        <Space.Compact style={{ width: "100%" }}>
                          <Form.Item name="sslCertPath" noStyle>
                            <Input
                              {...noAutoCapInputProps}
                              placeholder={t(
                                "connection.modal.example",
                                {
                                  value:
                                    "C:\\certs\\client-cert.pem",
                                },
                              )}
                            />
                          </Form.Item>
                          <Button
                            onClick={() => handleSelectCertificateFile("sslCertPath", "client-cert")}
                            loading={selectingCertificateField === "sslCertPath"}
                          >
                            {t("connection.modal.action.browse")}
                          </Button>
                        </Space.Compact>
                      </Form.Item>
                      <Form.Item
                        label={
                          dbType === "dameng"
                            ? t(
                                "connection.modal.network.ssl.damengKeyPath",
                              )
                            : t(
                                "connection.modal.network.ssl.keyPath",
                              )
                        }
                        rules={[
                          {
                            required: dbType === "dameng",
                            message: t(
                              "connection.modal.network.ssl.keyRequired",
                            ),
                          },
                        ]}
                        style={{ marginBottom: 0 }}
                      >
                        <Space.Compact style={{ width: "100%" }}>
                          <Form.Item name="sslKeyPath" noStyle>
                            <Input
                              {...noAutoCapInputProps}
                              placeholder={t(
                                "connection.modal.example",
                                {
                                  value:
                                    "C:\\certs\\client-key.pem",
                                },
                              )}
                            />
                          </Form.Item>
                          <Button
                            onClick={() => handleSelectCertificateFile("sslKeyPath", "client-key")}
                            loading={selectingCertificateField === "sslKeyPath"}
                          >
                            {t("connection.modal.action.browse")}
                          </Button>
                        </Space.Compact>
                      </Form.Item>
                    </>
                  )}
                </div>
              )}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {sslHintText}
              </Text>
            </div>
          )}
        </div>
      );
    }
    if (resolvedNetworkConfig === "ssh") {
      return (
        <div style={{ ...modalInnerSectionStyle, padding: 14 }}>
          <div
            style={{
              marginBottom: 8,
              color: darkMode ? "#f5f7ff" : "#162033",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {t("connection.modal.network.ssh.title")}
          </div>
          <div style={{ ...modalMutedTextStyle, marginBottom: 14 }}>
            {t("connection.modal.network.ssh.panelDescription")}
          </div>
        {!effectiveUseSSH ? (
            <div
              style={{
                ...modalMutedTextStyle,
                padding: "10px 12px",
                borderRadius: 12,
                background: darkMode
                  ? "rgba(255,255,255,0.03)"
                  : "rgba(16,24,40,0.04)",
              }}
            >
              {t("connection.modal.network.ssh.disabledHint")}
            </div>
          ) : (
            <div style={tunnelSectionStyle}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 120px",
                  gap: 16,
                }}
              >
                <Form.Item
                  name="sshHost"
                  label={t("connection.modal.network.ssh.host")}
                  rules={[
                    {
                      required: useSSH,
                      message: t(
                        "connection.modal.network.ssh.hostRequired",
                      ),
                    },
                  ]}
                  style={{ flex: 1 }}
                >
                  <Input
                    {...noAutoCapInputProps}
                    placeholder={t("connection.modal.example.or", {
                      first: "ssh.example.com",
                      second: "192.168.1.100",
                    })}
                  />
                </Form.Item>
                <Form.Item
                  name="sshPort"
                  label={t("connection.modal.field.port.label")}
                  rules={[
                    {
                      required: useSSH,
                      message: t(
                        "connection.modal.network.ssh.portRequired",
                      ),
                    },
                  ]}
                  style={{ width: 100 }}
                >
                  <InputNumber style={{ width: "100%" }} />
                </Form.Item>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 16,
                }}
              >
                <Form.Item
                  name="sshUser"
                  label={t("connection.modal.network.ssh.user")}
                  rules={[
                    {
                      required: useSSH,
                      message: t(
                        "connection.modal.network.ssh.userRequired",
                      ),
                    },
                  ]}
                  style={{ flex: 1 }}
                >
                  <Input
                    {...noAutoCapInputProps}
                    placeholder={t("connection.modal.example", {
                      value: "root",
                    })}
                  />
                </Form.Item>
                <Form.Item
                  name="sshPassword"
                  label={t("connection.modal.network.ssh.password")}
                  style={{ flex: 1 }}
                >
                  <Input.Password
                    {...noAutoCapInputProps}
                    placeholder={getStoredSecretPlaceholder({
                      hasStoredSecret: initialValues?.hasSSHPassword,
                      emptyPlaceholder: t(
                        "connection.modal.field.password.placeholder",
                      ),
                      retainedLabel: t(
                        "connection.modal.network.ssh.retained",
                      ),
                    })}
                  />
                </Form.Item>
              </div>
            <Form.Item
              label={t("connection.modal.network.ssh.keyPath")}
                help={t("connection.modal.example", {
                  value: "/Users/name/.ssh/id_rsa",
                })}
            >
                <Space.Compact style={{ width: "100%" }}>
                  <Form.Item name="sshKeyPath" noStyle>
                    <Input
                      {...noAutoCapInputProps}
                      placeholder={t(
                        "connection.modal.network.ssh.keyPathPlaceholder",
                      )}
                    />
                  </Form.Item>
                  <Button
                    onClick={handleSelectSSHKeyFile}
                    loading={selectingSSHKey}
                  >
                    {t("connection.modal.action.browse")}
                  </Button>
                </Space.Compact>
              </Form.Item>
              {renderStoredSecretControls({
                fieldName: "sshPassword",
                clearKey: "sshPassword",
                hasStoredSecret: initialValues?.hasSSHPassword,
                clearLabel: t(
                  "connection.modal.network.ssh.clearPassword",
                ),
                description: t(
                  "connection.modal.network.ssh.savedDescription",
                ),
              })}
            </div>
          )}
        </div>
      );
    }
    if (resolvedNetworkConfig === "proxy") {
      return (
        <div style={{ ...modalInnerSectionStyle, padding: 14 }}>
          <div
            style={{
              marginBottom: 8,
              color: darkMode ? "#f5f7ff" : "#162033",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {t("connection.modal.network.proxy.title")}
          </div>
          <div style={{ ...modalMutedTextStyle, marginBottom: 14 }}>
            {t("connection.modal.network.proxy.panelDescription")}
          </div>
          {!effectiveUseProxy ? (
            <div
              style={{
                ...modalMutedTextStyle,
                padding: "10px 12px",
                borderRadius: 12,
                background: darkMode
                  ? "rgba(255,255,255,0.03)"
                  : "rgba(16,24,40,0.04)",
              }}
            >
              {t("connection.modal.network.proxy.disabledHint")}
            </div>
          ) : (
            <div style={tunnelSectionStyle}>
              <Form.Item
                name="proxyHost"
                label={t("connection.modal.network.proxy.host")}
                rules={[
                  {
                    required: useProxy,
                    message: t(
                      "connection.modal.network.proxy.hostRequired",
                    ),
                  },
                ]}
              >
                <Input
                  {...noAutoCapInputProps}
                  placeholder={t("connection.modal.example.or", {
                    first: "127.0.0.1",
                    second: "proxy.company.com",
                  })}
                />
              </Form.Item>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 120px",
                  gap: 16,
                }}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  <Text strong>
                    {t("connection.modal.network.proxy.type")}
                  </Text>
                  {renderChoiceCards({
                    fieldName: "proxyType",
                    value: String(proxyType),
                    minWidth: 150,
                    options: [
                      {
                        value: "socks5",
                        label: "SOCKS5",
                        description: t(
                          "connection.modal.network.proxy.socks5.description",
                        ),
                      },
                      {
                        value: "http",
                        label: "HTTP CONNECT",
                        description: t(
                          "connection.modal.network.proxy.http.description",
                        ),
                      },
                    ],
                  })}
                </div>
                <Form.Item
                  name="proxyPort"
                  label={t("connection.modal.field.port.label")}
                  rules={[
                    {
                      required: useProxy,
                      message: t(
                        "connection.modal.network.proxy.portRequired",
                      ),
                    },
                  ]}
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={1}
                    max={65535}
                  />
                </Form.Item>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 16,
                }}
              >
                <Form.Item
                  name="proxyUser"
                  label={t("connection.modal.network.proxy.user")}
                  style={{ flex: 1 }}
                >
                  <Input
                    {...noAutoCapInputProps}
                    placeholder={t(
                      "connection.modal.network.proxy.noAuth",
                    )}
                  />
                </Form.Item>
                <Form.Item
                  name="proxyPassword"
                  label={t(
                    "connection.modal.network.proxy.password",
                  )}
                  style={{ flex: 1 }}
                >
                  <Input.Password
                    {...noAutoCapInputProps}
                    placeholder={getStoredSecretPlaceholder({
                      hasStoredSecret:
                        initialValues?.hasProxyPassword,
                      emptyPlaceholder: t(
                        "connection.modal.network.proxy.noAuth",
                      ),
                      retainedLabel: t(
                        "connection.modal.network.proxy.retained",
                      ),
                    })}
                  />
                </Form.Item>
              </div>
              {renderStoredSecretControls({
                fieldName: "proxyPassword",
                clearKey: "proxyPassword",
                hasStoredSecret: initialValues?.hasProxyPassword,
                clearLabel: t(
                  "connection.modal.network.proxy.clearPassword",
                ),
                description: t(
                  "connection.modal.network.proxy.savedDescription",
                ),
              })}
            </div>
          )}
        </div>
      );
    }
    return (
      <div style={{ ...modalInnerSectionStyle, padding: 14 }}>
        <div
          style={{
            marginBottom: 8,
            color: darkMode ? "#f5f7ff" : "#162033",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {t("connection.modal.network.httpTunnel.title")}
        </div>
        <div style={{ ...modalMutedTextStyle, marginBottom: 14 }}>
          {t(
            "connection.modal.network.httpTunnel.panelDescription",
          )}
        </div>
        {!effectiveUseHttpTunnel ? (
          <div
            style={{
              ...modalMutedTextStyle,
              padding: "10px 12px",
              borderRadius: 12,
              background: darkMode
                ? "rgba(255,255,255,0.03)"
                : "rgba(16,24,40,0.04)",
            }}
          >
            {t("connection.modal.network.httpTunnel.disabledHint")}
          </div>
        ) : (
          <div style={tunnelSectionStyle}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 120px",
                gap: 16,
              }}
            >
              <Form.Item
                name="httpTunnelHost"
                label={t(
                  "connection.modal.network.httpTunnel.host",
                )}
                rules={[
                  {
                    required: useHttpTunnel,
                    message: t(
                      "connection.modal.network.httpTunnel.hostRequired",
                    ),
                  },
                ]}
                style={{ flex: 1 }}
              >
                <Input
                  {...noAutoCapInputProps}
                  placeholder={t("connection.modal.example.or", {
                    first: "tunnel.company.com",
                    second: "127.0.0.1",
                  })}
                />
              </Form.Item>
              <Form.Item
                name="httpTunnelPort"
                label={t("connection.modal.field.port.label")}
                rules={[
                  {
                    required: useHttpTunnel,
                    message: t(
                      "connection.modal.network.httpTunnel.portRequired",
                    ),
                  },
                ]}
                style={{ width: 120 }}
              >
                <InputNumber
                  style={{ width: "100%" }}
                  min={1}
                  max={65535}
                />
              </Form.Item>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 16,
              }}
            >
              <Form.Item
                name="httpTunnelUser"
                label={t(
                  "connection.modal.network.httpTunnel.user",
                )}
                style={{ flex: 1 }}
              >
                <Input
                  {...noAutoCapInputProps}
                  placeholder={t(
                    "connection.modal.network.proxy.noAuth",
                  )}
                />
              </Form.Item>
              <Form.Item
                name="httpTunnelPassword"
                label={t(
                  "connection.modal.network.httpTunnel.password",
                )}
                style={{ flex: 1 }}
              >
                <Input.Password
                  {...noAutoCapInputProps}
                  placeholder={getStoredSecretPlaceholder({
                    hasStoredSecret:
                      initialValues?.hasHttpTunnelPassword,
                    emptyPlaceholder: t(
                      "connection.modal.network.proxy.noAuth",
                    ),
                    retainedLabel: t(
                      "connection.modal.network.httpTunnel.retained",
                    ),
                  })}
                />
              </Form.Item>
            </div>
            {renderStoredSecretControls({
              fieldName: "httpTunnelPassword",
              clearKey: "httpTunnelPassword",
              hasStoredSecret: initialValues?.hasHttpTunnelPassword,
              clearLabel: t(
                "connection.modal.network.httpTunnel.clearPassword",
              ),
              description: t(
                "connection.modal.network.httpTunnel.savedDescription",
              ),
            })}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t(
                "connection.modal.network.httpTunnel.exclusiveHint",
              )}
            </Text>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={modalInnerSectionStyle}>
      <div
        style={{
          marginBottom: 12,
          color: darkMode ? "#f5f7ff" : "#162033",
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        {t("connection.modal.network.title")}
      </div>
      <div style={{ ...modalMutedTextStyle, marginBottom: 16 }}>
        {t("connection.modal.network.description")}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {networkItems.map((item) => {
          const active = item.key === resolvedNetworkConfig;
          const activeColor = darkMode ? "#ffd666" : "#1677ff";
          return (
            <div
              key={item.key}
              role="button"
              tabIndex={0}
              onClick={() => setActiveNetworkConfig(item.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveNetworkConfig(item.key);
                }
              }}
              style={{
                ...getConnectionOptionCardStyle(item.enabled),
                borderColor: active
                  ? darkMode
                    ? "rgba(255,214,102,0.46)"
                    : "rgba(24,144,255,0.36)"
                  : "transparent",
                background: active
                  ? darkMode
                    ? "linear-gradient(180deg, rgba(255,214,102,0.14) 0%, rgba(255,214,102,0.08) 100%)"
                    : "linear-gradient(180deg, rgba(24,144,255,0.12) 0%, rgba(24,144,255,0.06) 100%)"
                  : getConnectionOptionCardStyle(item.enabled)
                      .background,
                boxShadow: active
                  ? darkMode
                    ? "0 0 0 1px rgba(255,214,102,0.18) inset, 0 12px 26px rgba(0,0,0,0.16)"
                    : "0 0 0 1px rgba(24,144,255,0.14) inset, 0 12px 22px rgba(24,144,255,0.10)"
                  : "none",
                cursor: "pointer",
                outline: "none",
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
                    width: 8,
                    height: 8,
                    marginTop: 8,
                    borderRadius: 999,
                    background: active ? activeColor : "transparent",
                    border: active
                      ? "none"
                      : darkMode
                        ? "1px solid rgba(255,255,255,0.12)"
                        : "1px solid rgba(16,24,40,0.12)",
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <Form.Item
                    name={
                      item.key === "ssl"
                        ? "useSSL"
                        : item.key === "ssh"
                          ? "useSSH"
                          : item.key === "proxy"
                            ? "useProxy"
                            : "useHttpTunnel"
                    }
                    valuePropName="checked"
                    noStyle
                  >
                    <Checkbox />
                  </Form.Item>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: darkMode ? "#f5f7ff" : "#162033",
                        }}
                      >
                        {item.title}
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {active && (
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 700,
                              color: activeColor,
                              background: darkMode
                                ? "rgba(255,214,102,0.16)"
                                : "rgba(24,144,255,0.12)",
                            }}
                          >
                            {t(
                              "connection.modal.network.currentEditing",
                            )}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: item.enabled
                              ? activeColor
                              : darkMode
                                ? "rgba(255,255,255,0.38)"
                                : "rgba(16,24,40,0.36)",
                          }}
                        >
                          {item.enabled
                            ? t("connection.modal.network.enabled")
                            : t(
                                "connection.modal.network.notEnabled",
                              )}
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        ...modalMutedTextStyle,
                        color: active
                          ? darkMode
                            ? "rgba(255,255,255,0.72)"
                            : "rgba(22,32,51,0.68)"
                          : modalMutedTextStyle.color,
                      }}
                    >
                      {item.description}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginBottom: 16 }}>{renderNetworkPanel()}</div>
      <div style={{ ...modalInnerSectionStyle, padding: 12 }}>
        <div
          style={{
            marginBottom: 10,
            color: darkMode ? "#f5f7ff" : "#162033",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {t("connection.modal.network.advanced.title")}
        </div>
        <Form.Item
          name="timeout"
          label={t("connection.modal.network.timeout.label")}
          help={t("connection.modal.network.timeout.help")}
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
          name="keepAliveEnabled"
          valuePropName="checked"
          help={t("connection.modal.network.keepAliveEnabled.help")}
          style={{ marginTop: 12, marginBottom: 12 }}
        >
          <Checkbox>
            {t("connection.modal.network.keepAliveEnabled.checkbox")}
          </Checkbox>
        </Form.Item>
        <Form.Item
          name="keepAliveIntervalMinutes"
          label={t("connection.modal.network.keepAliveInterval.label")}
          help={t("connection.modal.network.keepAliveInterval.help")}
          rules={[
            {
              type: "number",
              min: MIN_KEEPALIVE_INTERVAL_MINUTES,
              max: MAX_KEEPALIVE_INTERVAL_MINUTES,
              message: t("connection.modal.network.keepAliveInterval.range"),
            },
          ]}
          style={{ marginBottom: 0 }}
        >
          <InputNumber
            style={{ width: "100%" }}
            min={MIN_KEEPALIVE_INTERVAL_MINUTES}
            max={MAX_KEEPALIVE_INTERVAL_MINUTES}
            disabled={!keepAliveEnabled}
            placeholder={t("connection.modal.example", {
              value: String(DEFAULT_KEEPALIVE_INTERVAL_MINUTES),
            })}
          />
        </Form.Item>
        {keepAliveSQLSupported ? (
          <Form.Item
            name="keepAliveSQL"
            label={t("connection.modal.network.keepAliveSQL.label")}
            extra={t("connection.modal.network.keepAliveSQL.help")}
            rules={[
              {
                max: MAX_CONNECTION_KEEPALIVE_SQL_LENGTH,
                message: t("connection.modal.network.keepAliveSQL.maxLength"),
              },
              {
                validator: (_, value) => {
                  const sql = String(value || "").trim();
                  if (
                    !sql ||
                    !keepAliveEnabled ||
                    isSingleReadOnlyConnectionQuery(
                      {
                        type: dbType,
                        driver: connectionDriver,
                        oceanBaseProtocol: oceanBaseProtocol,
                      },
                      sql,
                    )
                  ) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error(t("connection.modal.network.keepAliveSQL.readOnly")),
                  );
                },
              },
            ]}
            style={{ marginTop: 12, marginBottom: 0 }}
          >
            <Input.TextArea
              {...noAutoCapInputProps}
              autoSize={{ minRows: 2, maxRows: 4 }}
              disabled={!keepAliveEnabled}
              maxLength={MAX_CONNECTION_KEEPALIVE_SQL_LENGTH}
              placeholder="SELECT 1"
              showCount
            />
          </Form.Item>
        ) : null}
      </div>
    </div>
  );
};

export default ConnectionModalNetworkSecuritySection;
