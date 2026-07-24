import { describe, expect, it } from 'vitest';

import { shouldAllowBlankCustomDsn } from './customConnectionDsn';

describe('shouldAllowBlankCustomDsn', () => {
  it('allows a blank DSN when editing a connection that already has a stored opaque DSN', () => {
    expect(shouldAllowBlankCustomDsn({
      dsnInput: '',
      hasStoredSecret: true,
      clearStoredSecret: false,
    })).toBe(true);
  });

  it('requires a new DSN when the user chooses to clear the stored opaque DSN', () => {
    expect(shouldAllowBlankCustomDsn({
      dsnInput: '',
      hasStoredSecret: true,
      clearStoredSecret: true,
    })).toBe(false);
  });

  it('requires a DSN for brand new custom connections', () => {
    expect(shouldAllowBlankCustomDsn({
      dsnInput: '',
      hasStoredSecret: false,
      clearStoredSecret: false,
    })).toBe(false);
  });

  it('accepts a newly entered DSN even when a stored secret already exists', () => {
    expect(shouldAllowBlankCustomDsn({
      dsnInput: 'driver://demo',
      hasStoredSecret: true,
      clearStoredSecret: true,
    })).toBe(true);
  });

  it('accepts a JDBC-style ClickHouse DSN for the backend compatibility adapter', () => {
    expect(shouldAllowBlankCustomDsn({
      dsnInput: 'jdbc:clickhouse://localhost:8123/default',
      hasStoredSecret: false,
      clearStoredSecret: false,
    })).toBe(true);
  });
});
