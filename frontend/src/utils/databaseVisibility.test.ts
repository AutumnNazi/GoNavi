import { describe, expect, it } from 'vitest';

import {
  filterVisibleDatabaseNames,
  hasDatabaseVisibilityRules,
  isDatabaseVisible,
  matchesDatabasePattern,
  moveExactDatabaseVisibilityEntry,
  removeExactDatabaseVisibilityEntry,
  resolveIncludeDatabasesAfterRemoval,
} from './databaseVisibility';

describe('database visibility patterns', () => {
  it('matches the complete database name and remains case-sensitive', () => {
    expect(matchesDatabasePattern('billing', 'billing')).toBe(true);
    expect(matchesDatabasePattern('billing_archive', 'billing')).toBe(false);
    expect(matchesDatabasePattern('Billing', 'billing')).toBe(false);
  });

  it('supports star and percent as equivalent zero-or-more wildcards', () => {
    expect(matchesDatabasePattern('team', 'team*')).toBe(true);
    expect(matchesDatabasePattern('team_prod', 'team*')).toBe(true);
    expect(matchesDatabasePattern('team_prod', 'team%')).toBe(true);
    expect(matchesDatabasePattern('preprod_archive', '*prod*')).toBe(true);
    expect(matchesDatabasePattern('team', 'team%prod')).toBe(false);
  });

  it('matches exactly one Unicode code point for underscore', () => {
    expect(matchesDatabasePattern('tenantA', 'tenant_')).toBe(true);
    expect(matchesDatabasePattern('tenant\ud83d\ude00', 'tenant_')).toBe(true);
    expect(matchesDatabasePattern('tenant', 'tenant_')).toBe(false);
    expect(matchesDatabasePattern('tenantAB', 'tenant_')).toBe(false);
  });

  it('supports literal wildcard and backslash characters through escaping', () => {
    expect(matchesDatabasePattern('sales_prod', 'sales\\_prod')).toBe(true);
    expect(matchesDatabasePattern('salesXprod', 'sales\\_prod')).toBe(false);
    expect(matchesDatabasePattern('star*db', 'star\\*db')).toBe(true);
    expect(matchesDatabasePattern('percent%db', 'percent\\%db')).toBe(true);
    expect(matchesDatabasePattern('path\\db', 'path\\\\db')).toBe(true);
  });

  it('treats a trailing or non-special backslash as a literal backslash', () => {
    expect(matchesDatabasePattern('archive\\', 'archive\\')).toBe(true);
    expect(matchesDatabasePattern('db\\q', 'db\\q')).toBe(true);
    expect(matchesDatabasePattern('dbq', 'db\\q')).toBe(false);
  });

  it('treats regular-expression syntax as literal database-name text', () => {
    const name = 'db.prod+(1)[x]{2}^$|?';
    expect(matchesDatabasePattern(name, name)).toBe(true);
    expect(matchesDatabasePattern('dbXprod+(1)[x]{2}^$|?', name)).toBe(false);
  });

  it('allows wildcards to span line characters without changing one-code-point semantics', () => {
    expect(matchesDatabasePattern('a\nb', 'a*b')).toBe(true);
    expect(matchesDatabasePattern('a\nb', 'a_b')).toBe(true);
    expect(matchesDatabasePattern('a\r\nb', 'a_b')).toBe(false);
  });
});

describe('database visibility rules', () => {
  it('shows every database when no include or exclude rule exists', () => {
    expect(isDatabaseVisible(undefined, 'app')).toBe(true);
    expect(filterVisibleDatabaseNames({}, ['app', 'audit'])).toEqual(['app', 'audit']);
    expect(hasDatabaseVisibilityRules({ includeDatabasePatterns: ['', ''] })).toBe(false);
    expect(hasDatabaseVisibilityRules({ excludeDatabasePatterns: ['sys%'] })).toBe(true);
  });

  it('preserves legacy includeDatabases as case-sensitive exact names', () => {
    const connection = { includeDatabases: ['user_prod'] };

    expect(isDatabaseVisible(connection, 'user_prod')).toBe(true);
    expect(isDatabaseVisible(connection, 'userXprod')).toBe(false);
    expect(isDatabaseVisible(connection, 'USER_PROD')).toBe(false);
  });

  it('uses exact includes and pattern includes as one inclusive OR set', () => {
    const connection = {
      includeDatabases: ['legacy_db'],
      includeDatabasePatterns: ['team%'],
    };

    expect(isDatabaseVisible(connection, 'legacy_db')).toBe(true);
    expect(isDatabaseVisible(connection, 'team_prod')).toBe(true);
    expect(isDatabaseVisible(connection, 'other')).toBe(false);
  });

  it('lets excludes win over both exact and pattern includes', () => {
    const connection = {
      includeDatabases: ['team_secret'],
      includeDatabasePatterns: ['team%'],
      excludeDatabasePatterns: ['team_secret', 'team_tmp%'],
    };

    expect(isDatabaseVisible(connection, 'team_prod')).toBe(true);
    expect(isDatabaseVisible(connection, 'team_secret')).toBe(false);
    expect(isDatabaseVisible(connection, 'team_tmp_2026')).toBe(false);
  });

  it('applies exclude-only rules to an otherwise visible complete list', () => {
    const connection = { excludeDatabasePatterns: ['sys%', '*_archive'] };

    expect(filterVisibleDatabaseNames(connection, [
      'app',
      'sys',
      'system',
      'app_archive',
    ])).toEqual(['app']);
  });

  it('ignores empty pattern entries instead of turning them into an include-all blocker', () => {
    expect(isDatabaseVisible({ includeDatabasePatterns: ['', ''] }, 'app')).toBe(true);
    expect(isDatabaseVisible({ excludeDatabasePatterns: ['', ''] }, 'app')).toBe(true);
    expect(isDatabaseVisible({ includeDatabasePatterns: ['   '] }, 'app')).toBe(true);
    expect(isDatabaseVisible({ excludeDatabasePatterns: ['\t'] }, 'app')).toBe(true);
    expect(hasDatabaseVisibilityRules({ includeDatabasePatterns: ['   '] })).toBe(false);
  });

  it('preserves source order and duplicate names without mutating the input', () => {
    const names = ['team_b', 'other', 'team_a', 'team_b'];
    const snapshot = [...names];

    expect(filterVisibleDatabaseNames({ includeDatabasePatterns: ['team%'] }, names)).toEqual([
      'team_b',
      'team_a',
      'team_b',
    ]);
    expect(names).toEqual(snapshot);
  });

  it('moves and removes exact database entries after database mutations', () => {
    const source = { includeDatabases: ['app', 'audit', 'archive'] };

    expect(moveExactDatabaseVisibilityEntry(source, 'audit', 'audit_v2')).toEqual([
      'app',
      'audit_v2',
      'archive',
    ]);
    expect(removeExactDatabaseVisibilityEntry(source, 'audit')).toEqual(['app', 'archive']);
    expect(removeExactDatabaseVisibilityEntry({ includeDatabases: ['app'] }, 'app')).toEqual([]);
    expect(source.includeDatabases).toEqual(['app', 'audit', 'archive']);
  });

  it('drops the whitelist instead of locking it onto the deleted database', () => {
    // 白名单被删空时必须落回空数组（= 不过滤、全部可见）。回填被删库名会把连接锁死，
    // 用户此后在该连接上只能看到一个已不存在的库，侧边栏报 no_visible_databases。
    expect(resolveIncludeDatabasesAfterRemoval({ includeDatabases: ['audit'] }, [], 'audit')).toEqual([]);

    // 还有别的库加载着时保留它们，维持用户此前的收窄视图。
    expect(resolveIncludeDatabasesAfterRemoval({ includeDatabases: ['audit'] }, ['app'], 'audit')).toEqual(['app']);

    // 白名单未删空：只移除目标项，其余原样保留。
    expect(resolveIncludeDatabasesAfterRemoval({ includeDatabases: ['app', 'audit'] }, ['app'], 'audit')).toEqual(['app']);

    // 本来就没有白名单：不引入过滤规则。
    expect(resolveIncludeDatabasesAfterRemoval({}, ['app'], 'audit')).toBeUndefined();

    // 入参不被就地修改。
    const source = { includeDatabases: ['audit'] };
    resolveIncludeDatabasesAfterRemoval(source, [], 'audit');
    expect(source.includeDatabases).toEqual(['audit']);
  });

  it('matches database names case-insensitively when the data source says so', () => {
    // IRIS/Caché 的契约声明 schemaIdentifierCaseSensitive=false：服务端把命名空间
    // 规范化成大写（USER），而用户在「数据库显示范围」里手输的往往是小写。精确匹配
    // 若仍区分大小写，唯一返回的库会被整体滤掉，侧栏只剩「未返回可见数据库或结构」。
    const iris = { includeDatabases: ['user'], config: { type: 'iris' } };
    const cache = { includeDatabases: ['user'], config: { type: 'cache' } };

    expect(isDatabaseVisible(iris, 'USER')).toBe(true);
    expect(filterVisibleDatabaseNames(iris, ['USER'])).toEqual(['USER']);
    expect(isDatabaseVisible(cache, 'USER')).toBe(true);
    expect(filterVisibleDatabaseNames(cache, ['USER'])).toEqual(['USER']);

    // 反向也成立：白名单存大写、服务端返回小写。
    expect(isDatabaseVisible({ includeDatabases: ['USER'], config: { type: 'iris' } }, 'user')).toBe(true);

    // 过滤只判断可见性，返回的仍是服务端原始名字，不改成白名单的大小写。
    expect(filterVisibleDatabaseNames({ includeDatabases: ['gonaviiris'], config: { type: 'iris' } }, ['GONAVIIRIS']))
      .toEqual(['GONAVIIRIS']);

    // exclude 通配符同样跟随该语义。
    expect(isDatabaseVisible({ excludeDatabasePatterns: ['sys*'], config: { type: 'iris' } }, 'SYSLOG')).toBe(false);
  });

  it('keeps exact matching case-sensitive for case-sensitive data sources', () => {
    // PostgreSQL 声明 schemaIdentifierCaseSensitive=true，必须保持原样：库名大小写不同
    // 就是不同的库，放宽会让用户看到本不该出现的库。
    const postgres = { includeDatabases: ['user'], config: { type: 'postgres' } };
    expect(isDatabaseVisible(postgres, 'USER')).toBe(false);
    expect(isDatabaseVisible(postgres, 'user')).toBe(true);
    expect(filterVisibleDatabaseNames(postgres, ['USER', 'user'])).toEqual(['user']);
  });

  it('defaults to case-sensitive matching when no connection config is given', () => {
    // 缺省必须保持历史行为，避免影响没带 config 的调用方（例如 redis 合成的可见性对象）。
    expect(isDatabaseVisible({ includeDatabases: ['user'] }, 'USER')).toBe(false);
    expect(isDatabaseVisible({ includeDatabases: ['user'] }, 'user')).toBe(true);
    expect(matchesDatabasePattern('USER', 'user')).toBe(false);
  });

  it('applies the same case semantics to rename and removal bookkeeping', () => {
    const iris = { includeDatabases: ['user'], config: { type: 'iris' } };

    // 重命名按不区分大小写命中，并保留用户输入的写法。
    expect(moveExactDatabaseVisibilityEntry(iris, 'USER', 'USER2')).toEqual(['USER2']);
    // 删除最后一项时返回空数组（而非 undefined），删除路径据此落回「不过滤」。
    expect(removeExactDatabaseVisibilityEntry(iris, 'USER')).toEqual([]);

    // 区分大小写的数据源不受影响。
    const postgres = { includeDatabases: ['user'], config: { type: 'postgres' } };
    expect(removeExactDatabaseVisibilityEntry(postgres, 'USER')).toEqual(['user']);
  });
});
