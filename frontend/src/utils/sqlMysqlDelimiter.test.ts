import { describe, expect, it } from 'vitest';

import { textHasMysqlDelimiterDirective } from './sqlMysqlDelimiter';
import { findSqlStatementRanges } from './sqlStatementSelection';

const split = (sql: string, dbType = 'mysql') => findSqlStatementRanges(sql, dbType).map((range) => range.text);

describe('MySQL DELIMITER scripts', () => {
  it('keeps procedure bodies intact and drops directive lines', () => {
    const sql = [
      'DROP PROCEDURE IF EXISTS p;',
      'DELIMITER $$',
      'CREATE PROCEDURE p()',
      'BEGIN',
      '  WHILE x > 0 DO',
      '    SET x = x - 1;',
      '  END WHILE;',
      'END$$',
      'DELIMITER ;',
      'CALL p();',
    ].join('\n');

    expect(split(sql)).toEqual([
      'DROP PROCEDURE IF EXISTS p',
      'CREATE PROCEDURE p()\nBEGIN\n  WHILE x > 0 DO\n    SET x = x - 1;\n  END WHILE;\nEND',
      'CALL p()',
    ]);
  });

  it('matches the backend for comments, lowercase keywords and strings', () => {
    const sql = "-- install\ndelimiter ;;\nCREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN SET NEW.x = ';;'; END;;\ndelimiter ;\nSELECT 1;";

    expect(split(sql, 'mariadb')).toEqual([
      "CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN SET NEW.x = ';;'; END",
      'SELECT 1',
    ]);
  });

  it('only recognizes standalone directive lines in mysql dialects', () => {
    expect(textHasMysqlDelimiterDirective('mysql', 'DELIMITER $$\nSELECT 1$$')).toBe(true);
    expect(textHasMysqlDelimiterDirective('mysql', '  delimiter //\nSELECT 1//')).toBe(true);
    expect(textHasMysqlDelimiterDirective('mysql', 'SELECT delimiter FROM t;')).toBe(false);
    expect(textHasMysqlDelimiterDirective('mysql', 'DELIMITER\nSELECT 1;')).toBe(false);
    expect(textHasMysqlDelimiterDirective('sqlserver', 'DELIMITER $$\nSELECT 1$$')).toBe(false);
  });

  it('leaves scripts without directives on the regular splitter', () => {
    expect(split('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });
});
