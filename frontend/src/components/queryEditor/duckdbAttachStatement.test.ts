import { describe, expect, it } from 'vitest';

import {
  buildDuckDBAttachStatementText,
  buildDuckDBDetachStatementText,
  escapeDuckDBAttachStringLiteral,
  isDuckDBAttachableConnection,
  isDuckDBAttachableConnectionType,
  slugifyDuckDBAttachAlias,
} from './duckdbAttachStatement';

describe('isDuckDBAttachableConnectionType', () => {
  it('accepts supported types case-insensitively', () => {
    expect(isDuckDBAttachableConnectionType('mysql')).toBe(true);
    expect(isDuckDBAttachableConnectionType('Postgres')).toBe(true);
    expect(isDuckDBAttachableConnectionType('duckdb')).toBe(true);
  });

  it('rejects unsupported or empty types', () => {
    expect(isDuckDBAttachableConnectionType('oracle')).toBe(false);
    expect(isDuckDBAttachableConnectionType('')).toBe(false);
  });
});

describe('slugifyDuckDBAttachAlias', () => {
  it('keeps latin words and folds separators', () => {
    expect(slugifyDuckDBAttachAlias('Report DB', 'id-1')).toBe('Report_DB');
    expect(slugifyDuckDBAttachAlias('  orders-db  ', 'id-1')).toBe('orders_db');
  });

  it('falls back to saved_db plus id fragment for non-latin names', () => {
    expect(slugifyDuckDBAttachAlias('生产库-订单', 'a3f8c2e1-9d44-4b7a')).toBe('saved_db_a3f8c2e1');
    expect(slugifyDuckDBAttachAlias('9库', '')).toBe('saved_db');
  });
});

describe('escapeDuckDBAttachStringLiteral', () => {
  it('doubles single quotes', () => {
    expect(escapeDuckDBAttachStringLiteral("it's db")).toBe("it''s db");
    expect(escapeDuckDBAttachStringLiteral('')).toBe('');
  });
});

describe('buildDuckDBAttachStatementText', () => {
  it('builds a full read-only statement with alias', () => {
    expect(buildDuckDBAttachStatementText({
      connectionId: 'conn-1',
      alias: 'orders_db',
      readOnly: true,
    })).toBe("ATTACH SAVED CONNECTION 'conn-1' AS orders_db READ ONLY");
  });

  it('omits alias when absent and supports read write', () => {
    expect(buildDuckDBAttachStatementText({
      connectionId: 'conn-1',
      readOnly: false,
    })).toBe('ATTACH SAVED CONNECTION \'conn-1\' READ WRITE');
  });

  it('escapes quotes in the connection id', () => {
    expect(buildDuckDBAttachStatementText({
      connectionId: "con'n",
      alias: 'a',
      readOnly: true,
    })).toBe("ATTACH SAVED CONNECTION 'con''n' AS a READ ONLY");
  });

  it('rejects invalid alias and empty id', () => {
    expect(buildDuckDBAttachStatementText({ connectionId: '', alias: 'a', readOnly: true })).toBe('');
    expect(buildDuckDBAttachStatementText({
      connectionId: 'c',
      alias: 'bad alias',
      readOnly: true,
    })).toBe('');
  });
});

describe('buildDuckDBDetachStatementText', () => {
  it('builds detach for a valid alias', () => {
    expect(buildDuckDBDetachStatementText('orders_db')).toBe('DETACH SAVED CONNECTION orders_db');
  });

  it('rejects invalid alias', () => {
    expect(buildDuckDBDetachStatementText('bad alias')).toBe('');
  });
});

describe('isDuckDBAttachableConnection', () => {
  it('rejects oceanbase with oracle protocol while accepting mysql protocol', () => {
    expect(isDuckDBAttachableConnection({ type: 'oceanbase', oceanBaseProtocol: 'oracle' })).toBe(false);
    expect(isDuckDBAttachableConnection({ type: 'oceanbase', oceanBaseProtocol: 'mysql' })).toBe(true);
    expect(isDuckDBAttachableConnection({ type: 'mysql' })).toBe(true);
    expect(isDuckDBAttachableConnection(null)).toBe(false);
  });
});
