export interface DatabaseVisibilitySource {
  includeDatabases?: readonly string[] | null;
  includeDatabasePatterns?: readonly string[] | null;
  excludeDatabasePatterns?: readonly string[] | null;
}

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
}

const escapeRegExpCharacter = (character: string): string =>
  REGEXP_SPECIAL_CHARACTERS.has(character) ? `\\${character}` : character;

const compileDatabasePattern = (pattern: string): RegExp => {
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
  return new RegExp(source.join(''), 'u');
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
): PreparedDatabaseVisibility => ({
  // includeDatabases predates wildcard filters and must remain exact. In particular,
  // underscores in existing database names must never acquire wildcard semantics.
  exactIncludes: new Set(nonEmptyStrings(connection?.includeDatabases)),
  includePatterns: nonEmptyPatterns(connection?.includeDatabasePatterns).map(compileDatabasePattern),
  excludePatterns: nonEmptyPatterns(connection?.excludeDatabasePatterns).map(compileDatabasePattern),
});

const matchesAnyPattern = (databaseName: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(databaseName));

const isDatabaseVisibleWithPreparedRules = (
  rules: PreparedDatabaseVisibility,
  databaseName: string,
): boolean => {
  if (matchesAnyPattern(databaseName, rules.excludePatterns)) return false;

  const hasIncludes = rules.exactIncludes.size > 0 || rules.includePatterns.length > 0;
  if (!hasIncludes) return true;

  return rules.exactIncludes.has(databaseName)
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
  const seen = new Set<string>();
  const next = source.includeDatabases.reduce<string[]>((result, item) => {
    const name = String(item || '').trim();
    if (!name) return result;
    const moved = name === from ? to : name;
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
  return source.includeDatabases.filter((name) => name !== target);
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
