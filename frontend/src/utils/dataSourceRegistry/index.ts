import {
  DATA_SOURCE_VARIANT_AUTO,
  type DataSourceCatalogGroup,
  type DataSourceSpec,
  type DataSourceVariant,
} from './types';

export * from './types';

// 每个数据源一个描述文件，与 Go 侧 internal/datasource 读取的是同一批文件。
const specModules = import.meta.glob<DataSourceSpec>('../../../../internal/datasource/specs/*.json', {
  eager: true,
  import: 'default',
});

const registrySpecs: DataSourceSpec[] = Object.values(specModules).sort(
  (left, right) => (left.order ?? 0) - (right.order ?? 0) || left.type.localeCompare(right.type),
);

const normalizeName = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const specsByCanonicalType = new Map<string, DataSourceSpec>();
const canonicalByName = new Map<string, string>();
const specsByDialect = new Map<string, DataSourceSpec>();

for (const spec of registrySpecs) {
  specsByCanonicalType.set(spec.type, spec);
  specsByDialect.set(spec.dialect, spec);
  for (const name of [spec.type, ...(spec.aliases ?? [])]) {
    canonicalByName.set(normalizeName(name), spec.type);
  }
}

/** 返回描述表里的全部数据源，顺序与文档一致。 */
export const listDataSourceSpecs = (): readonly DataSourceSpec[] => registrySpecs;

/** 把类型名或别名归一为描述表规范类型；不是描述表类型时返回 undefined。 */
export const resolveDataSourceType = (value: unknown): string | undefined =>
  canonicalByName.get(normalizeName(value));

/** 按类型名或别名查找描述表条目。 */
export const getDataSourceSpec = (value: unknown): DataSourceSpec | undefined => {
  const canonical = resolveDataSourceType(value);
  return canonical ? specsByCanonicalType.get(canonical) : undefined;
};

/** 描述表类型归一；不是描述表类型时原样返回小写值，便于接在历史归一函数的 default 分支。 */
export const canonicalizeDataSourceType = (value: unknown): string =>
  resolveDataSourceType(value) ?? normalizeName(value);

export const isRegistryDataSource = (value: unknown): boolean => resolveDataSourceType(value) !== undefined;

/** 判断描述表类型是否声明了某个兼容家族（mysql、postgres、oracle、sqlite 等）。 */
export const isDataSourceFamily = (value: unknown, family: string): boolean =>
  getDataSourceSpec(value)?.family === family;

/** 按编辑器方言键查找描述（resolveSqlDialect 对描述表类型返回 spec.dialect）。 */
export const getDataSourceSpecByDialect = (dialect: unknown): DataSourceSpec | undefined =>
  specsByDialect.get(normalizeName(dialect));

/** 方言键所属的兼容家族；不是描述表方言时返回 undefined。 */
export const getDataSourceDialectFamily = (dialect: unknown): string | undefined =>
  getDataSourceSpecByDialect(dialect)?.family;

export const listDataSourceSpecsInGroup = (group: DataSourceCatalogGroup): DataSourceSpec[] =>
  registrySpecs.filter((spec) => spec.group === group);

export const listDataSourceTypesWhere = (predicate: (spec: DataSourceSpec) => boolean): string[] =>
  registrySpecs.filter(predicate).map((spec) => spec.type);

/** 连接表单可选的驱动版本档位（不含自动识别）。 */
export const getDataSourceVariants = (value: unknown): DataSourceVariant[] =>
  getDataSourceSpec(value)?.variants.items ?? [];

/** 用户未显式选择时连接实际采用的档位值（可能是 auto）。 */
export const getDefaultDataSourceVariant = (value: unknown): string | undefined =>
  getDataSourceSpec(value)?.variants.default;

export const supportsAutoDataSourceVariant = (value: unknown): boolean =>
  Boolean(getDataSourceSpec(value)?.variants.auto);

/** 档位是否需要独立的驱动代理构建（需要在驱动管理里单独安装）。 */
export const dataSourceVariantNeedsSeparateAgent = (value: unknown, variantId: string): boolean => {
  const spec = getDataSourceSpec(value);
  if (!spec) return false;
  const selected = normalizeName(variantId) || spec.variants.default;
  if (selected === DATA_SOURCE_VARIANT_AUTO) return false;
  return Boolean(spec.variants.items.find((item) => item.id === selected)?.build);
};
