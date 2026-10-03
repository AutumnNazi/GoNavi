// 与 internal/datasource/datasources.json 保持字段一致；Go 侧读取同一份文档。

export type DataSourceCatalogGroup =
  | 'relational'
  | 'domestic'
  | 'nosql'
  | 'search'
  | 'vector'
  | 'timeseries'
  | 'bigdata'
  | 'config_center';

export type DataSourceAgentBuild = {
  // 代理驱动键：默认代理留空（等同类型名），独立构建档位必填（如 cassandra_legacy）。
  key?: string;
  buildTag: string;
  goModule?: string;
  version?: string;
  cgo?: boolean;
  platforms?: string[];
  sourcePrefixes?: string[];
};

export type DataSourceVariant = {
  id: string;
  label: string;
  descriptionKey?: string;
  minServer?: string;
  maxServer?: string;
  build?: DataSourceAgentBuild;
};

export type DataSourceVariantSet = {
  auto?: boolean;
  default: string;
  items: DataSourceVariant[];
};

// 连接表单相关的前端声明；Go 侧忽略该段。
export type DataSourceUISpec = {
  uriSchemes?: string[];
  ssl?: boolean;
  sslCAPath?: boolean;
  sslClientCert?: boolean;
  usernameOptional?: boolean;
  connectionParams?: boolean;
  hintKey?: string;
  hint?: string;
  // 允许展示的网络安全分区（ssl、ssh、proxy、httpTunnel）；缺省表示全部。
  networkSections?: string[];
  layout?: string;
  icon?: { color: string; scale?: number; asset?: string };
};

export type DataSourceSpec = {
  type: string;
  aliases?: string[];
  displayName: string;
  group: DataSourceCatalogGroup;
  order?: number;
  defaultPort?: number;
  wire: string;
  dialect: string;
  ddlDialect?: string;
  family?: string;
  objectKind?: string;
  caseSensitiveIdentifiers?: boolean;
  versionQuery?: string;
  syntheticDatabase?: boolean;
  proxyMode?: 'forward' | 'driver';
  protection?: boolean;
  excelImport?: boolean;
  agent: DataSourceAgentBuild;
  variants: DataSourceVariantSet;
  ui?: DataSourceUISpec;
};

export const DATA_SOURCE_VARIANT_AUTO = 'auto';
