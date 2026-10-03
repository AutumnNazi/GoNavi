// 非 SQL 查询语言的描述表数据源按方言判定语句是否只读（只读保护、写操作提示与事务托管共用）。
// 规则与 Go 侧一致：Weaviate 见 internal/db/weaviate_command.go，InfluxDB 见 internal/db/influxdb_command.go。
// 分类器返回 undefined 表示交给通用 SQL 规则（如 InfluxQL、InfluxDB 3.x 的 SQL）。

type ReadOnlyClassifier = (statement: string) => boolean | undefined;

const WEAVIATE_REST_LINE = /^(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(\/\S*)\s*$/i;

/** Weaviate：GraphQL（没有 mutation）、GET / HEAD 与 POST /v1/graphql 的 REST 请求、SELECT 为只读。 */
export const isReadOnlyWeaviateCommand = (statement: string): boolean => {
  const text = String(statement || '').trim();
  if (!text || text.startsWith('{') || /^query[\s{]/i.test(text)) {
    return true;
  }
  const match = WEAVIATE_REST_LINE.exec(text.split('\n', 1)[0].trim());
  if (match) {
    const method = match[1].toUpperCase();
    let path = match[2].split('?')[0];
    if (path !== '/v1' && !path.startsWith('/v1/')) {
      path = `/v1${path}`;
    }
    return method === 'GET' || method === 'HEAD' || (method === 'POST' && path === '/v1/graphql');
  }
  return /^select\b/i.test(text);
};

const FLUX_WRITE_CALL = /(^|[^A-Za-z0-9_])(to|wideTo)\s*\(/i;

/** 识别 Flux：以 import 或 from( 开头，或含管道符 |>。 */
export const isInfluxFluxQuery = (statement: string): boolean => {
  const text = String(statement || '').trim();
  return /^import[\s"]/i.test(text) || /^from\s*\(/i.test(text) || text.includes('|>');
};

/** InfluxDB：Flux 只在调用 to() / wideTo() 时写数据；InfluxQL 与 SQL 交给通用规则。 */
const classifyInfluxDBStatement = (statement: string): boolean | undefined => (
  isInfluxFluxQuery(statement) ? !FLUX_WRITE_CALL.test(statement) : undefined
);

const REGISTRY_READ_ONLY_CLASSIFIERS: Record<string, ReadOnlyClassifier> = {
  weaviate: isReadOnlyWeaviateCommand,
  influxdb: classifyInfluxDBStatement,
};

/** 返回该方言的只读判定函数；SQL 方言返回 undefined，交给通用 SQL 规则。 */
export const resolveRegistryReadOnlyClassifier = (dialect: string): ReadOnlyClassifier | undefined =>
  REGISTRY_READ_ONLY_CLASSIFIERS[String(dialect || '').trim().toLowerCase()];
