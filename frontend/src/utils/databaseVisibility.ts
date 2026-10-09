import type { ConnectionConfig } from '../types';
import { getDataSourceCapabilities } from './dataSourceCapabilities';

export interface DatabaseVisibilitySource {
  includeDatabases?: readonly string[] | null;
  includeDatabasePatterns?: readonly string[] | null;
  excludeDatabasePatterns?: readonly string[] | null;
  /**
   * 连接配置。存在时按数据源能力契约的 navigation.schemaIdentifierCaseSensitive
   * 决定库名是否区分大小写；缺省按区分大小写处理，保持历史行为不变。
   */
  config?: Pick<ConnectionConfig, 'type' | 'driver' | 'oceanBaseProtocol'> | null;
}

// 库名与 schema 名共用同一套标识符语义：契约只有一个大小写标识。IRIS/Caché 声明
// schemaIdentifierCaseSensitive=false，即大小写不敏感 —— 服务端把命名空间规范化成
// 大写（USER），用户在「数据库显示范围」里手输 user 时，精确匹配必须仍能命中，
// 否则返回的库会被整体滤掉，侧栏只剩一条「未返回可见数据库或结构」。
const resolveDatabaseCaseSensitive = (
  connection: DatabaseVisibilitySource | null | undefined,
): boolean => {
  const config = connection?.config;
  if (!config) return true;
  try {
    return getDataSourceCapabilities(config).schemaIdentifierCaseSensitive !== false;
  } catch {
    // 配置残缺（例如构造中的连接）时退回保守的区分大小写，不影响既有连接。
    return true;
  }
};

const databaseNameIdentity = (name: string, caseSensitive: boolean): string =>
  (caseSensitive ? name : name.toLocaleLowerCase());

const REGEXP_SPECIAL_CHARACTERS = new Set([
  '\\',
  '^',
  '$',
  '.',
  '*',
  '+',
  '?',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '|',
]);

const ESCAPABLE_PATTERN_CHARACTERS = new Set(['*', '%', '_', '\\']);
const ZERO_OR_MORE_CODE_POINTS = '[\\s\\S]*';
const EXACTLY_ONE_CODE_POINT = '[\\s\\S]';

interface PreparedDatabaseVisibility {
  exactIncludes: Set<string>;
  includePatterns: RegExp[];
  excludePatterns: RegExp[];
  caseSensitive: boolean;
}

const escapeRegExpCharacter = (character: string): string =>
  REGEXP_SPECIAL_CHARACTERS.has(character) ? `\\${character}` : character;

const compileDatabasePattern = (pattern: string, caseSensitive = true): RegExp => {
  const characters = Array.from(pattern);
  const source: string[] = ['^'];

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];

    if (character === '\\') {
      const nextCharacter = characters[index + 1];
      if (nextCharacter && ESCAPABLE_PATTERN_CHARACTERS.has(nextCharacter)) {
        source.push(escapeRegExpCharacter(nextCharacter));
        index += 1;
      } else {
        source.push(escapeRegExpCharacter(character));
      }
      continue;
    }

    if (character === '*' || character === '%') {
      source.push(ZERO_OR_MORE_CODE_POINTS);
      continue;
    }

    if (character === '_') {
      source.push(EXACTLY_ONE_CODE_POINT);
      continue;
    }

    source.push(escapeRegExpCharacter(character));
  }

  source.push('$');
  return new RegExp(source.join(''), caseSensitive ? 'u' : 'iu');
};

const nonEmptyStrings = (values: readonly string[] | null | undefined): string[] => {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
};

const nonEmptyPatterns = (values: readonly string[] | null | undefined): string[] => {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const prepareDatabaseVisibility = (
  connection: DatabaseVisibilitySource | null | undefined,
): PreparedDatabaseVisibility => {
  const caseSensitive = resolveDatabaseCaseSensitive(connection);
  // includeDatabases 保持精确匹配（下划线绝不能获得通配符语义），只是精确比较的
  // 大小写语义跟随数据源契约，与 schema 标识符保持一致。
  const identity = (name: string): string => databaseNameIdentity(name, caseSensitive);
  return {
    exactIncludes: new Set(nonEmptyStrings(connection?.includeDatabases).map(identity)),
    includePatterns: nonEmptyPatterns(connection?.includeDatabasePatterns)
      .map((pattern) => compileDatabasePattern(pattern, caseSensitive)),
    excludePatterns: nonEmptyPatterns(connection?.excludeDatabasePatterns)
      .map((pattern) => compileDatabasePattern(pattern, caseSensitive)),
    caseSensitive,
  };
};

const matchesAnyPattern = (databaseName: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(databaseName));

const isDatabaseVisibleWithPreparedRules = (
  rules: PreparedDatabaseVisibility,
  databaseName: string,
): boolean => {
  if (matchesAnyPattern(databaseName, rules.excludePatterns)) return false;

  const hasIncludes = rules.exactIncludes.size > 0 || rules.includePatterns.length > 0;
  if (!hasIncludes) return true;

  return rules.exactIncludes.has(databaseNameIdentity(databaseName, rules.caseSensitive))
    || matchesAnyPattern(databaseName, rules.includePatterns);
};

export const matchesDatabasePattern = (databaseName: string, pattern: string): boolean =>
  compileDatabasePattern(pattern).test(databaseName);

export const hasDatabaseVisibilityRules = (
  connection: DatabaseVisibilitySource | null | undefined,
): boolean => nonEmptyStrings(connection?.includeDatabases).length > 0
  || nonEmptyPatterns(connection?.includeDatabasePatterns).length > 0
  || nonEmptyPatterns(connection?.excludeDatabasePatterns).length > 0;

export const isDatabaseVisible = (
  connection: DatabaseVisibilitySource | null | undefined,
  databaseName: string,
): boolean => isDatabaseVisibleWithPreparedRules(
  prepareDatabaseVisibility(connection),
  databaseName,
);

export const filterVisibleDatabaseNames = (
  connection: DatabaseVisibilitySource | null | undefined,
  databaseNames: readonly string[],
): string[] => {
  const rules = prepareDatabaseVisibility(connection);
  return databaseNames.filter((databaseName) =>
    isDatabaseVisibleWithPreparedRules(rules, databaseName));
};

export const moveExactDatabaseVisibilityEntry = (
  source: DatabaseVisibilitySource,
  fromDatabase: unknown,
  toDatabase: unknown,
): string[] | undefined => {
  const from = String(fromDatabase || '').trim();
  const to = String(toDatabase || '').trim();
  if (!from || !to || !Array.isArray(source.includeDatabases)) {
    return source.includeDatabases ? [...source.includeDatabases] : undefined;
  }
  const caseSensitive = resolveDatabaseCaseSensitive(source);
  const fromIdentity = databaseNameIdentity(from, caseSensitive);
  const seen = new Set<string>();
  const next = source.includeDatabases.reduce<string[]>((result, item) => {
    const name = String(item || '').trim();
    if (!name) return result;
    const moved = databaseNameIdentity(name, caseSensitive) === fromIdentity ? to : name;
    if (seen.has(moved)) return result;
    seen.add(moved);
    result.push(moved);
    return result;
  }, []);
  return next.length > 0 ? next : undefined;
};

export const removeExactDatabaseVisibilityEntry = (
  source: DatabaseVisibilitySource,
  database: unknown,
): string[] | undefined => {
  const target = String(database || '').trim();
  if (!target || !Array.isArray(source.includeDatabases)) {
    return source.includeDatabases ? [...source.includeDatabases] : undefined;
  }
  const caseSensitive = resolveDatabaseCaseSensitive(source);
  const targetIdentity = databaseNameIdentity(target, caseSensitive);
  return source.includeDatabases.filter(
    (name) => databaseNameIdentity(String(name ?? '').trim(), caseSensitive) !== targetIdentity,
  );
};

// 删除数据库后重算 includeDatabases 白名单。
//
// includeDatabases 为空表示"不过滤、全部可见"，所以白名单被删空时必须落回空数组。
// 曾经这里回填的是 removedDatabase 本身：白名单于是锁在一个刚被删掉的库上，过滤后
// 一个库都不剩，侧边栏随即报 sidebar.message.no_visible_databases —— 用户删库后
// 整个连接就废了。仍加载着的库名优先保留，以维持用户此前的收窄视图。
export const resolveIncludeDatabasesAfterRemoval = (
  source: DatabaseVisibilitySource,
  remainingLoadedDatabases: readonly string[],
  removedDatabase: unknown,
): string[] | undefined => {
  const exactIncludes = removeExactDatabaseVisibilityEntry(source, removedDatabase);
  const hadIncludes = Array.isArray(source.includeDatabases) && source.includeDatabases.length > 0;
  if (!hadIncludes || exactIncludes?.length !== 0) {
    return exactIncludes;
  }
  return remainingLoadedDatabases.length > 0 ? [...remainingLoadedDatabases] : [];
};
