import { describe, expect, it } from 'vitest';

import { findSqlStatementRanges, resolveExecutableSql } from './sqlStatementSelection';

const split = (sql: string, dbType: string) => findSqlStatementRanges(sql, dbType).map((range) => range.text);
const procedure = (control: string) => [
  'CREATE PROCEDURE p()',
  'BEGIN',
  control,
  'END',
].join('\n');
const whileBody = procedure('  WHILE x > 0 DO\n    SET x = x - 1;\n  END WHILE;');
const repeatBody = procedure('  REPEAT\n    SET x = x - 1;\n  UNTIL x <= 0 END REPEAT;');

// Keep the exact RPC texts in sync with TestSplitSQLStatementsMySQLQueryEditorRPCPayload.
const rejoinedBatch = `DROP PROCEDURE IF EXISTS p;\n${whileBody};\nCALL p()`;

describe('MySQL routine splitting after DELIMITER removal', () => {
  it.each(['mysql', 'mariadb', ' MySQL '])('preserves the full-run RPC payload for %s', (dbType) => {
    expect(split(rejoinedBatch, dbType)).toEqual(['DROP PROCEDURE IF EXISTS p', `${whileBody};`, 'CALL p()']);
  });

  it.each(['mysql', 'mariadb'])('preserves the cursor-run RPC payload for %s', (dbType) => {
    expect(split(whileBody, dbType)).toEqual([whileBody]);
    const script = `DROP PROCEDURE IF EXISTS p;\nDELIMITER $$\n${whileBody}$$\nDELIMITER ;\nCALL p();`;
    const selected = resolveExecutableSql(script, script.indexOf('SET x'), '', dbType)?.sql;
    expect(selected).toBe(whileBody);
    expect(split(selected || '', dbType).join(';\n')).toBe(whileBody);
  });

  it.each(['mysql', 'mariadb'])('preserves nested WHILE, REPEAT, CASE and BEGIN for %s', (dbType) => {
    const body = procedure([
      '  outer_loop: WHILE x > 0 DO',
      '    REPEAT',
      '      BEGIN',
      "        SET x = CASE WHEN x > 1 THEN x - 1 ELSE 0 END;",
      '      END;',
      '    UNTIL x <= 0 END REPEAT;',
      '  END /* loop ends, not BEGIN */ WHILE outer_loop;',
      '  SET @finished = 1;',
    ].join('\n'));
    expect(split(`${body};\nSELECT 2;`, dbType)).toEqual([`${body};`, 'SELECT 2']);
    expect(split(`${repeatBody};\nSELECT 2;`, dbType)).toEqual([`${repeatBody};`, 'SELECT 2']);
  });

  it.each(['mysql', 'mariadb'])('ignores control words inside strings and comments for %s', (dbType) => {
    const body = procedure([
      "  SET @label = 'END WHILE; END REPEAT;';",
      '  -- END WHILE;',
      '  # END REPEAT;',
      '  WHILE x > 0 DO',
      '    SET x = x - 1;',
      '  end /* comments between keywords */ wHiLe;',
      '  SET @finished = 1;',
    ].join('\n'));
    expect(split(`${body};\nCALL p();`, dbType)).toEqual([`${body};`, 'CALL p()']);
  });

  it.each(['oracle', 'postgres', 'sqlserver', 'iris', 'cache', ''])(
    'does not reinterpret END repeat as MySQL control flow for %s',
    (dbType) => {
      const body = 'CREATE PROCEDURE repeat() AS\nBEGIN\n  NULL;\nEND repeat;';
      expect(split(`${body}\nSELECT 2;`, dbType)).toEqual([body, 'SELECT 2']);
    },
  );

  it.each(['mysql', 'mariadb'])('does not match keyword prefixes or quoted labels for %s', (dbType) => {
    for (const label of ['while_label', 'repeat_label', '`while`', '`repeat`']) {
      const body = `BEGIN\n  SET @x = 1;\nEND ${label};`;
      expect(split(`${body}\nSELECT 2;`, dbType)).toEqual([body, 'SELECT 2']);
    }
  });
});
