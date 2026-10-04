import { getConnectionTypeDefaultPort as getDefaultPortByType } from "../../utils/connectionTypeCatalog";
import {
  supportsSSLCAPathForType,
  supportsSSLClientCertificateForType,
  isPostgresCompatibleSSLType,
} from "../../utils/connectionTypeCapabilities";
import {
  safeDecode,
  MAX_URI_HOSTS,
  isValidUriHostEntry,
  normalizeAddressList,
  parseHostPort,
  normalizeUriBool,
  serializeConnectionParams,
} from "./connectionModalUriHosts";

export const parseMultiHostUri = (uriText: string, expectedScheme: string) => {
  const prefix = `${expectedScheme}://`;
  if (!uriText.toLowerCase().startsWith(prefix)) {
    return null;
  }
  let rest = uriText.slice(prefix.length);
  const hashIndex = rest.indexOf("#");
  if (hashIndex >= 0) {
    rest = rest.slice(0, hashIndex);
  }
  let queryText = "";
  const queryIndex = rest.indexOf("?");
  if (queryIndex >= 0) {
    queryText = rest.slice(queryIndex + 1);
    rest = rest.slice(0, queryIndex);
  }

  let pathText = "";
  const slashIndex = rest.indexOf("/");
  const hasExplicitPath = slashIndex >= 0;
  if (slashIndex >= 0) {
    pathText = rest.slice(slashIndex + 1);
    rest = rest.slice(0, slashIndex);
  }

  let hostText = rest;
  let username = "";
  let password = "";
  const atIndex = rest.lastIndexOf("@");
  if (atIndex >= 0) {
    const userInfo = rest.slice(0, atIndex);
    hostText = rest.slice(atIndex + 1);
    const colonIndex = userInfo.indexOf(":");
    if (colonIndex >= 0) {
      username = safeDecode(userInfo.slice(0, colonIndex));
      password = safeDecode(userInfo.slice(colonIndex + 1));
    } else {
      username = safeDecode(userInfo);
    }
  }

  const hosts = hostText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    username,
    password,
    hosts,
    database: safeDecode(pathText),
    hasExplicitPath,
    params: new URLSearchParams(queryText),
  };
};

export const parseSingleHostUri = (
  uriText: string,
  expectedSchemes: string[],
  defaultPort: number,
): {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  hasExplicitPath: boolean;
  params: URLSearchParams;
} | null => {
  let parsed: ReturnType<typeof parseMultiHostUri> | null = null;
  for (const scheme of expectedSchemes) {
    parsed = parseMultiHostUri(uriText, scheme);
    if (parsed) {
      break;
    }
  }
  if (!parsed) {
    return null;
  }
  if (!parsed.hosts.length || parsed.hosts.length > MAX_URI_HOSTS) {
    return null;
  }
  if (parsed.hosts.some((entry) => !isValidUriHostEntry(entry))) {
    return null;
  }
  const hostList = normalizeAddressList(parsed.hosts, defaultPort);
  if (!hostList.length) {
    return null;
  }
  const primary = parseHostPort(
    hostList[0] || `localhost:${defaultPort}`,
    defaultPort,
  );
  return {
    host: primary?.host || "localhost",
    port: primary?.port || defaultPort,
    username: parsed.username,
    password: parsed.password,
    database: parsed.database || "",
    hasExplicitPath: parsed.hasExplicitPath,
    params: parsed.params,
  };
};

export const parseClickHouseHTTPUriToValues = (
  uriText: string,
  fallbackPort?: number,
): Record<string, any> | null => {
  const trimmed = String(uriText || "").trim();
  const lower = trimmed.toLowerCase();
  const isHttps = lower.startsWith("https://");
  const isHttp = lower.startsWith("http://");
  if (!isHttp && !isHttps) {
    return null;
  }
  const defaultPort =
    Number.isFinite(Number(fallbackPort)) && Number(fallbackPort) > 0
      ? Number(fallbackPort)
      : isHttps
        ? 8443
        : 8123;
  const parsed = parseSingleHostUri(
    trimmed,
    [isHttps ? "https" : "http"],
    defaultPort,
  );
  if (!parsed) {
    return null;
  }
  const skipVerify = normalizeUriBool(parsed.params.get("skip_verify"));
  return {
    host: parsed.host,
    port: parsed.port,
    user: parsed.username,
    password: parsed.password,
    database: parsed.database || "",
    clickHouseProtocol: "http",
    useSSL: isHttps,
    sslMode: isHttps ? (skipVerify ? "skip-verify" : "required") : "disable",
    ...extractSSLPathValuesFromParams(parsed.params, "clickhouse"),
    connectionParams: serializeConnectionParams(parsed.params),
  };
};

export const normalizeNacosContextPath = (raw: unknown): string => {
  const text = String(raw ?? "").trim();
  if (!text || text === "/") {
    return text === "/" ? "/" : "/nacos";
  }
  return `/${text.replace(/^\/+|\/+$/g, "")}`;
};

export const encodeNacosContextPath = (raw: unknown): string => {
  const normalized = normalizeNacosContextPath(raw);
  if (normalized === "/") {
    return "/";
  }
  return normalized
    .split("/")
    .map((segment, index) => (index === 0 ? "" : encodeURIComponent(segment)))
    .join("/");
};

export const splitTrinoNamespace = (
  raw: unknown,
): { catalog: string; schema: string } => {
  const text = String(raw || "").trim();
  if (!text) {
    return { catalog: "", schema: "" };
  }
  const [catalog, schema = ""] = text.split(".", 2);
  return {
    catalog: String(catalog || "").trim(),
    schema: String(schema || "").trim(),
  };
};

const joinTrinoNamespace = (catalog: string, schema: string) => {
  const safeCatalog = String(catalog || "").trim();
  const safeSchema = String(schema || "").trim();
  if (!safeCatalog) return safeSchema;
  if (!safeSchema) return safeCatalog;
  return `${safeCatalog}.${safeSchema}`;
};

export const parseTrinoUriToValues = (
  uriText: string,
): Record<string, any> | null => {
  const trimmed = String(uriText || "").trim();
  const parsed = parseSingleHostUri(
    trimmed,
    ["trino", "http", "https"],
    getDefaultPortByType("trino"),
  );
  if (!parsed) {
    return null;
  }
  const params = new URLSearchParams(parsed.params);
  const catalog = String(params.get("catalog") || "").trim();
  const schema = String(params.get("schema") || "").trim();
  params.delete("catalog");
  params.delete("schema");

  const skipVerify = normalizeUriBool(
    params.get("skip_verify") || params.get("skipVerify"),
  );
  params.delete("skip_verify");
  params.delete("skipVerify");

  const namespace =
    joinTrinoNamespace(catalog, schema) || String(parsed.database || "").trim();
  return {
    host: parsed.host,
    port: parsed.port,
    user: parsed.username,
    password: parsed.password,
    database: namespace,
    useSSL: trimmed.toLowerCase().startsWith("https://"),
    sslMode: trimmed.toLowerCase().startsWith("https://")
      ? (skipVerify ? "skip-verify" : "required")
      : "disable",
    ...extractSSLPathValuesFromParams(params, "trino"),
    connectionParams: serializeConnectionParams(params),
  };
};

const firstConnectionParamValue = (
  params: URLSearchParams,
  names: string[],
): string => {
  for (const name of names) {
    const value = String(params.get(name) || "").trim();
    if (value) return value;
  }
  return "";
};

export const extractSSLPathValuesFromParams = (
  params: URLSearchParams,
  type: string,
): Record<string, string> => {
  const caPath = firstConnectionParamValue(params, [
    "sslCAPath",
    "ssl_ca_path",
    "sslrootcert",
    "sslRootCert",
    "tlsCAFile",
    "caFile",
    "certificate",
    "servercertificate",
    "serverCertificate",
  ]);
  const certPath = firstConnectionParamValue(params, [
    "sslCertPath",
    "ssl_cert_path",
    "SSL_CERT_PATH",
    "sslcert",
    "sslCert",
    "tlsCertificateFile",
  ]);
  const keyPath = firstConnectionParamValue(params, [
    "sslKeyPath",
    "ssl_key_path",
    "SSL_KEY_PATH",
    "sslkey",
    "sslKey",
    "tlsKeyFile",
  ]);
  return {
    ...(supportsSSLCAPathForType(type) && caPath ? { sslCAPath: caPath } : {}),
    ...(supportsSSLClientCertificateForType(type) && certPath ? { sslCertPath: certPath } : {}),
    ...(supportsSSLClientCertificateForType(type) && keyPath ? { sslKeyPath: keyPath } : {}),
  };
};

export const appendSSLPathParamsForUri = (
  params: URLSearchParams,
  type: string,
  values: Record<string, any>,
) => {
  const caPath = String(values.sslCAPath || "").trim();
  const certPath = String(values.sslCertPath || "").trim();
  const keyPath = String(values.sslKeyPath || "").trim();
  const mode = String(values.sslMode || "preferred")
    .trim()
    .toLowerCase();
  if (supportsSSLCAPathForType(type) && caPath) {
    if (isPostgresCompatibleSSLType(type)) {
      if (mode !== "skip-verify" && mode !== "disable") {
        params.set("sslrootcert", caPath);
      }
    } else if (type === "sqlserver") {
      params.set("certificate", caPath);
    } else {
      params.set("sslCAPath", caPath);
    }
  }
  if (supportsSSLClientCertificateForType(type) && certPath) {
    if (type === "dameng") {
      params.set("SSL_CERT_PATH", certPath);
    } else if (isPostgresCompatibleSSLType(type)) {
      params.set("sslcert", certPath);
    } else {
      params.set("sslCertPath", certPath);
    }
  }
  if (supportsSSLClientCertificateForType(type) && keyPath) {
    if (type === "dameng") {
      params.set("SSL_KEY_PATH", keyPath);
    } else if (isPostgresCompatibleSSLType(type)) {
      params.set("sslkey", keyPath);
    } else {
      params.set("sslKeyPath", keyPath);
    }
  }
};
