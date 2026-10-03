// 与 internal/datasource/specs/<type>.json 保持字段一致；Go 侧读取同一批文件。

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
  // 标识符引号：缺省按兼容家族（mysql → 反引号，postgres → 按需双引号），其余为双引号。
  quoting?: 'backtick' | 'pg' | 'double' | 'bracket';
  // 侧栏不显示的对象分组（routines、triggers、events、sequences 等）：借用方言里有、该数据源没有的对象。
  hiddenObjectGroups?: string[];
  // 表别名语法：缺省 oracle 家族为 bare，其余为 as；非 SQL 查询语言用 none。
  tableAlias?: 'as' | 'bare' | 'none';
  // 数据浏览分页语法：缺省 LIMIT n OFFSET m。
  pagination?: 'limit-offset' | 'limit-range' | 'offset-limit' | 'limit-start' | 'skip-first' | 'rows-to' | 'offset-fetch';
  // 图标：asset 指向官方 logo；缺省时使用 /db-icons/<type>.svg（可由 tools/generate-datasource-icons.py 生成字母徽标）。
  icon?: { color: string; text?: string; scale?: number; asset?: string };
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
