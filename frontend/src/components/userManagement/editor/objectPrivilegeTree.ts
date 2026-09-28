import type { UMGrant } from '../userManagementTypes';

/**
 * 对象树布局：
 * - database：库 → 表 → 列（MySQL / ClickHouse / TDengine）
 * - database-schema：当前库 → 模式 → 表 → 列（PG 系 / SQL Server，授权按库存放）
 * - schema：模式（用户）→ 表 → 列（Oracle / 达梦）
 */
export type ObjectTreeLayout = 'database' | 'database-schema' | 'schema';

export const resolveObjectTreeLayout = (family: string): ObjectTreeLayout => {
  switch (family) {
    case 'postgres':
    case 'opengauss':
    case 'sqlserver':
      return 'database-schema';
    case 'oracle':
    case 'dameng':
      return 'schema';
    default:
      return 'database';
  }
};

/** 拆分 schema.table；未限定时 schema 为空。 */
export const splitQualifiedTable = (name: string): { schema: string; table: string } => {
  const index = name.indexOf('.');
  if (index <= 0) return { schema: '', table: name };
  return { schema: name.slice(0, index), table: name.slice(index + 1) };
};

const TARGET_FIELDS = ['scope', 'database', 'schema', 'object', 'column', 'objectType'] as const;

/** 授权目标（不含权限名）的稳定键。 */
export const targetKey = (target: UMGrant): string => JSON.stringify(TARGET_FIELDS.map((field) => String(target[field] || '')));

export const targetFromKey = (key: string): UMGrant => {
  const values = JSON.parse(key) as string[];
  const target: UMGrant = { privilege: '', scope: values[0] };
  TARGET_FIELDS.slice(1).forEach((field, index) => {
    if (values[index + 1]) target[field] = values[index + 1];
  });
  return target;
};

/** 目标的可读路径，如 sales.public.orders.amount。 */
export const describeTarget = (target: UMGrant): string => (
  [target.database, target.schema, target.object, target.column].filter(Boolean).join('.')
  || (target.objectType ? `${target.objectType}` : '*')
);

/** 草稿中已有授权的非全局目标（去重，保持首次出现顺序）。 */
export const grantedTargets = (grants: UMGrant[]): UMGrant[] => {
  const seen = new Set<string>();
  const targets: UMGrant[] = [];
  grants.forEach((grant) => {
    if (grant.scope === 'global') return;
    const target: UMGrant = { ...grant, privilege: '', withGrantOption: undefined, deny: undefined, inherited: undefined };
    const key = targetKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(targetFromKey(key));
  });
  return targets;
};

export const tableTarget = (layout: ObjectTreeLayout, database: string, qualified: string): UMGrant => {
  const { schema, table } = splitQualifiedTable(qualified);
  if (layout === 'schema') return { privilege: '', scope: 'table', schema: database, object: qualified.includes('.') ? table : qualified };
  const target: UMGrant = { privilege: '', scope: 'table', database, object: table };
  if (schema) target.schema = schema;
  return target;
};
