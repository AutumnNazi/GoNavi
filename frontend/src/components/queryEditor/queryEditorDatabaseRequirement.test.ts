import { describe, expect, it } from 'vitest';

import { canExecuteQueryEditorSQLWithoutDatabase } from './queryEditorDatabaseRequirement';

describe('canExecuteQueryEditorSQLWithoutDatabase', () => {
  it('allows database-free SHOW statements on MySQL-family dialects', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW DATABASES', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW SCHEMAS', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW GRANTS FOR \'u\'@\'%\'', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW GLOBAL VARIABLES LIKE \'%timeout%\'', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW ENGINE INNODB STATUS', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW REPLICAS', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW PROCESSLIST', 'mariadb')).toBe(true);
  });

  it('keeps database-dependent SHOW statements blocked without a qualifier', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW TABLES', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW OPEN TABLES', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW COLUMNS FROM t', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW CREATE TABLE t', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW TRIGGERS', 'mysql')).toBe(false);
  });

  it('allows qualified SHOW variants that name their own database or object', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW TABLES FROM mydb', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW FULL TABLES IN mydb', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW TABLE STATUS FROM mydb', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW COLUMNS FROM db.t', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW INDEX FROM t FROM mydb', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW CREATE TABLE db.t', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW CREATE DATABASE mydb', 'mysql')).toBe(true);
  });

  it('allows SELECT/WITH statements without unqualified table references', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT 1', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT VERSION()', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT * FROM information_schema.TABLES', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT * FROM t', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT * FROM a, b', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT * FROM db.t', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT name FROM sys.databases', 'sqlserver')).toBe(true);
  });

  it('allows server-level statements that never need a default database', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('USE mydb', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('CREATE DATABASE foo', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('DROP DATABASE foo', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('CREATE USER u@\'%\' IDENTIFIED BY \'x\'', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('GRANT ALL ON *.* TO u', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SET @x = 1', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('KILL 123', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('BEGIN', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('COMMIT', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SET search_path TO public', 'postgres')).toBe(true);
  });

  it('allows operand-free shapes of SET/GRANT/REVOKE/FLUSH', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('SET NAMES utf8mb4', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SET autocommit = 1', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SET @x = (SELECT 1)', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('GRANT SELECT ON db.* TO u', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('REVOKE SELECT ON db.t FROM u', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('GRANT role_u TO user_u', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('FLUSH PRIVILEGES', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('FLUSH TABLES', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('FLUSH TABLES WITH READ LOCK', 'mysql')).toBe(true);
  });

  it('blocks management statements that hide unqualified table operands', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('SET @x = (SELECT * FROM t)', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('GRANT SELECT ON t TO u', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('REVOKE SELECT ON t FROM u', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('FLUSH TABLES t1, t2', 'mysql')).toBe(false);
  });

  it('keeps write and table DDL statements conservative', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('INSERT INTO t VALUES (1)', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('UPDATE t SET a = 1', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('DELETE FROM t', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('TRUNCATE TABLE t', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('CREATE TABLE t (id INT)', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('CALL do_something()', 'mysql')).toBe(false);
  });

  it('requires every statement in a batch to be database-free', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW DATABASES; SELECT 1', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW DATABASES; SHOW TABLES', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT 1; SELECT * FROM t', 'mysql')).toBe(false);
  });

  it('keeps UNION and scalar-subquery references to unqualified tables blocked', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT 1 UNION SELECT * FROM t', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT (SELECT COUNT(*) FROM t)', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT 1 UNION SELECT 2', 'mysql')).toBe(true);
  });

  it('stays conservative for CTE aliases resolved as table references', () => {
    // Documented false negative: the shared table scanner reports the CTE
    // alias as an unqualified reference, so the batch keeps asking for a
    // database even though it would run without one.
    expect(canExecuteQueryEditorSQLWithoutDatabase('WITH c AS (SELECT 1) SELECT * FROM c', 'mysql')).toBe(false);
  });

  it('matches SHOW/DESC regardless of case and line breaks', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('show databases', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('show\ndatabases', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('desc db.t', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('describe t', 'mysql')).toBe(false);
  });

  it('unwraps EXPLAIN FORMAT=JSON prefixes before classification', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('EXPLAIN FORMAT=JSON SELECT * FROM information_schema.tables', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('EXPLAIN FORMAT = JSON SELECT * FROM t', 'mysql')).toBe(false);
  });

  it('ignores statement separators inside string literals', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT \'a;b\'', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT * FROM t WHERE c = \'; DROP DATABASE x\'', 'mysql')).toBe(false);
  });

  it('unwraps EXPLAIN prefixes before classification', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('EXPLAIN SELECT 1', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('EXPLAIN ANALYZE SELECT * FROM information_schema.TABLES', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('EXPLAIN SELECT * FROM t', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('EXPLAIN db.t', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('EXPLAIN t', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('DESC db.t', 'mysql')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('DESCRIBE t', 'mysql')).toBe(false);
  });

  it('handles ClickHouse and TDengine catalog SHOW statements like MySQL', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW DATABASES', 'clickhouse')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW TABLES', 'clickhouse')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW TABLES FROM mydb', 'clickhouse')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW DATABASES', 'tdengine')).toBe(true);
  });

  it('is conservative for non-MySQL dialects beyond shared SELECT rules', () => {
    // PG connections always carry a database, so its SHOW statements stay
    // conservatively blocked without a selection.
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW ALL', 'postgres')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW server_version', 'postgres')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT 1', 'postgres')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT 1 FROM DUAL', 'oracle')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SELECT 1', 'oracle')).toBe(true);
    expect(canExecuteQueryEditorSQLWithoutDatabase('SHOW DATABASES', 'mongodb')).toBe(false);
  });

  it('returns false for empty or blank SQL', () => {
    expect(canExecuteQueryEditorSQLWithoutDatabase('', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase('   ', 'mysql')).toBe(false);
    expect(canExecuteQueryEditorSQLWithoutDatabase(undefined, 'mysql')).toBe(false);
  });
});
