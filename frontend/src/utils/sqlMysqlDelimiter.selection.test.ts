import { describe, expect, it } from 'vitest';

import {
  findSqlStatementRanges,
  resolveCurrentSqlStatementRange,
  resolveExecutableSql,
  resolveSqlStatementPrefix,
} from './sqlStatementSelection';

const split = (sql: string, dbType = 'mysql') => findSqlStatementRanges(sql, dbType).map((range) => range.text);

const procedure = [
  'CREATE PROCEDURE p()',
  'BEGIN',
  '  WHILE x > 0 DO',
  '    SET x = x - 1;',
  '  END WHILE;',
  'END',
].join('\n');

const script = `DROP PROCEDURE IF EXISTS p;\nDELIMITER $$\n${procedure}$$\nDELIMITER ;\nCALL p();`;

describe('MySQL DELIMITER statement selection', () => {
  it.each(['CREATE PROCEDURE', 'SET x', 'END WHILE', 'END$$'])(
    'resolves the complete procedure from a cursor at %s',
    (cursorText) => {
      const offset = script.indexOf(cursorText);
      expect(resolveCurrentSqlStatementRange(script, offset, 'mysql')).toEqual({
        start: script.indexOf('CREATE PROCEDURE'),
        end: script.indexOf('END$$') + 'END'.length,
        text: procedure,
      });
      expect(resolveExecutableSql(script, offset, '', 'mysql')).toEqual({
        sql: procedure,
        source: 'statement',
      });
    },
  );

  it('keeps statement ranges aligned with their source slices', () => {
    const ranges = findSqlStatementRanges(script, 'mysql');
    expect(ranges.map((range) => script.slice(range.start, range.end))).toEqual([
      'DROP PROCEDURE IF EXISTS p', procedure, 'CALL p()',
    ]);
    expect(resolveExecutableSql(script, script.indexOf('CALL'), '', 'mysql')).toEqual({
      sql: 'CALL p()',
      source: 'statement',
    });
  });

  it('does not strip directives from an explicit script selection', () => {
    expect(resolveExecutableSql(script, 0, script, 'mysql')).toEqual({ sql: script, source: 'selection' });
  });

  it('does not execute a directive-only script', () => {
    const sql = '-- installer\nDELIMITER $$\nDELIMITER ;';
    expect(findSqlStatementRanges(sql, 'mysql')).toEqual([]);
    expect(resolveExecutableSql(sql, 0, '', 'mysql')).toBeNull();
  });

  it('resolves the unfinished body prefix after a directive', () => {
    const sql = 'DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n';
    expect(resolveSqlStatementPrefix(sql, 'mysql')).toBe('CREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n');
    expect(resolveSqlStatementPrefix(`DELIMITER $$\n${procedure}$$\n`, 'mysql')).toBe('');
  });

  it.each(['$$', '//', ';;'])('keeps %s inside strings, identifiers and comments', (delimiter) => {
    const statement = [
      'CREATE PROCEDURE quoted()',
      'BEGIN',
      `  SELECT 'a''${delimiter}b', "a""${delimiter}b", \`a\`\`${delimiter}b\`;`,
      `  SELECT 'a\\'${delimiter}b', "a\\\"${delimiter}b";`,
      `  -- ${delimiter}`,
      `  # ${delimiter}`,
      `  /* ${delimiter} */`,
      'END',
    ].join('\n');
    expect(split(`DELIMITER ${delimiter}\n${statement}${delimiter}\nDELIMITER ;\nSELECT 2;`)).toEqual([
      statement, 'SELECT 2',
    ]);
  });

  it('accepts indented mixed-case directives and CRLF with a reset at EOF', () => {
    const sql = '-- installer\r\n\tDeLiMiTeR //  \r\nSELECT 1//\r\n  delimiter ;';
    expect(split(sql, ' MariaDB ')).toEqual(['SELECT 1']);
  });

  it('keeps the MySQL whitespace requirement for dash comments', () => {
    expect(split('DELIMITER //\nSELECT 3--2//\nSELECT 4//')).toEqual(['SELECT 3--2', 'SELECT 4']);
  });

  it.each([
    ['block comment', '/* documentation\nDELIMITER $$\n*/'],
    ['single-quoted string', "SELECT '\nDELIMITER $$\n' AS marker;"],
    ['double-quoted string', 'SELECT "\nDELIMITER $$\n" AS marker;'],
    ['backtick identifier', 'SELECT `\nDELIMITER $$\n` FROM t;'],
  ])('does not switch parsers for a directive line inside a %s', (_name, prefix) => {
    const block = 'BEGIN NOT ATOMIC\n  SET @value = 1;\nEND;';
    const sql = `${prefix}\n${block}\nSELECT 2;`;
    expect(split(sql, 'mariadb')).toEqual(prefix.startsWith('/*')
      ? [`${prefix}\n${block}`, 'SELECT 2']
      : [prefix.slice(0, -1), block, 'SELECT 2']);
  });

  it('does not consume a directive-looking line in an unfinished statement', () => {
    const statement = 'SELECT\nDELIMITER $$\n1';
    expect(split(`DELIMITER //\n${statement}//\nDELIMITER ;\nSELECT 2;`)).toEqual([statement, 'SELECT 2']);
  });

  it.each(['postgres', 'sqlserver', 'iris', 'cache', 'oceanbase'])(
    'does not consume MySQL client directives for %s',
    (dbType) => {
      expect(split('DELIMITER //\nSELECT 1//', dbType)).toEqual(['DELIMITER //\nSELECT 1//']);
    },
  );
});
