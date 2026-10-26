import { describe, expect, it } from 'vitest';

import { buildUriFromValues, getUriPlaceholder, parseUriToValues } from '../../components/connectionModal/connectionModalUri';
import { buildViewsMetadataQuerySpecs } from '../../components/sidebar/sidebarMetadataQuerySpecs';
import { supportsTableClearAction } from '../../components/tableDataDangerActions';
import { CONNECTION_TYPE_GROUPS, getConnectionTypeDefaultPort } from '../connectionTypeCatalog';
import { findPotentiallyMutatingConnectionStatements, supportsConnectionReadOnlyMode } from '../connectionReadOnly';
import { getDataSourceCapabilities, getDataSourceCapabilityContract } from '../dataSourceCapabilities';
import { buildPaginatedSelectSQL, quoteIdentPart } from '../sql';
import { isMysqlFamilyDialect, resolveSqlDialect } from '../sqlDialectCore';
import { formatSqlExecutionError } from '../sqlErrorSemantics';
import { resolveSidebarMetadataDialect } from '../sidebarMetadata';
import {
  canonicalizeDataSourceType,
  getDataSourceSpec,
  getDataSourceVariants,
  getDefaultDataSourceVariant,
  supportsAutoDataSourceVariant,
} from './index';

const hive = { type: 'hive' } as never;

describe('Apache Hive registry behavior', () => {
  it('joins the big data group on port 10000 with its own dialect and MySQL-family quoting', () => {
    const group = CONNECTION_TYPE_GROUPS.find((item) => item.labelKey.endsWith('.bigdata'));
    expect(group?.items.map((item) => item.key)).toContain('hive');
    expect(getConnectionTypeDefaultPort('hive')).toBe(10000);
    expect(canonicalizeDataSourceType('Apache-Hive')).toBe('hive');
    expect(canonicalizeDataSourceType('hiveserver2')).toBe('hive');
    expect(canonicalizeDataSourceType('hs2')).toBe('hive');
    expect(resolveSqlDialect('hive')).toBe('hive');
    expect(isMysqlFamilyDialect('hive')).toBe(true);
    expect(quoteIdentPart('hive', 'ods_orders')).toBe('`ods_orders`');
    expect(buildPaginatedSelectSQL('hive', 'SELECT * FROM `dw`.`ods_orders`', ' ORDER BY `order_id`', 50, 100)).toBe(
      'SELECT * FROM `dw`.`ods_orders` ORDER BY `order_id` LIMIT 50 OFFSET 100',
    );
  });

  it('declares v3 and v4 driver variants with auto detection', () => {
    expect(getDataSourceSpec('hive')?.ui?.defaultUser).toBe('hive');
    expect(supportsAutoDataSourceVariant('hive')).toBe(true);
    expect(getDefaultDataSourceVariant('hive')).toBe('auto');
    expect(getDataSourceVariants('hive').map((item) => item.id)).toEqual(['v3', 'v4']);
  });

  it('parses hive:// and jdbc:hive2:// connection strings including semicolon parameters', () => {
    expect(parseUriToValues('hive://hive:secret@hs2.example.com:10000/dw?auth=PLAIN', 'hive')).toMatchObject({
      host: 'hs2.example.com',
      port: 10000,
      user: 'hive',
      password: 'secret',
      database: 'dw',
      connectionParams: 'auth=PLAIN',
    });
    expect(parseUriToValues('jdbc:hive2://hs2.example.com:10000/dw;auth=noSasl;ssl=true', 'hive')).toMatchObject({
      host: 'hs2.example.com',
      port: 10000,
      database: 'dw',
      useSSL: true,
      sslMode: 'required',
    });
    expect(buildUriFromValues({ type: 'hive', host: '10.0.0.8', port: 10000, user: 'hive', database: 'dw', timeout: 30 })).toBe(
      'hive://hive@10.0.0.8:10000/dw?timeout=30',
    );
    expect(getUriPlaceholder('hive')).toContain('hive://user:pass@127.0.0.1:10000');
  });

  it('lists views with SHOW VIEWS and exposes Hive capability profile', () => {
    const sqls = buildViewsMetadataQuerySpecs(resolveSidebarMetadataDialect('hive'), 'dw').map((spec) => spec.sql);
    expect(sqls).toEqual(['SHOW VIEWS IN `dw`', 'SHOW VIEWS']);
    const contract = getDataSourceCapabilityContract(hive);
    expect(contract.transaction?.supported).toBe(false);
    const capabilities = getDataSourceCapabilities(hive);
    expect(capabilities.supportsUserManagement).toBe(false);
    expect(capabilities.supportsExplainDiagnosis).toBe(true);
    expect(capabilities.supportsSqlQueryExport).toBe(true);
    expect(supportsTableClearAction('hive')).toBe(true);
  });

  it('explains Hive SemanticException and ParseException messages', () => {
    expect(formatSqlExecutionError("Error while compiling statement: FAILED: SemanticException [Error 10001]: Line 1:14 Table not found 'nope'")).toContain(
      'Table or object does not exist',
    );
    expect(
      formatSqlExecutionError("Error while compiling statement: FAILED: SemanticException [Error 10004]: Line 1:7 Invalid table alias or column reference 'nope'"),
    ).toContain('Column does not exist');
    expect(formatSqlExecutionError("Error while compiling statement: FAILED: ParseException line 1:7 cannot recognize input near 'FORM' 't' '<EOF>'")).toContain(
      'SQL syntax error',
    );
  });

  it('classifies writes for read-only protection', () => {
    expect(supportsConnectionReadOnlyMode(hive)).toBe(true);
    for (const statement of ['SELECT * FROM dw.ods_orders', 'SHOW TABLES', 'DESCRIBE FORMATTED dw.ods_orders']) {
      expect(findPotentiallyMutatingConnectionStatements(hive, statement), statement).toEqual([]);
    }
    for (const statement of ['INSERT INTO dw.ods_orders VALUES (1)', 'DROP TABLE dw.ods_orders', 'CREATE TABLE dw.t AS SELECT 1 AS id']) {
      expect(findPotentiallyMutatingConnectionStatements(hive, statement), statement).toEqual([statement]);
    }
  });
});
