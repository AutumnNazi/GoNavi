import type { JSONValue } from './types.js';

export const DATA_SOURCE_PROTOCOL_VERSION = 1;
export const DATA_SOURCE_WRITE_PROTOCOL_VERSION = 2;
export type DataSourceReadOperation = 'connect' | 'ping' | 'close' | 'query' | 'databases' | 'tables' | 'createStatement' | 'columns' | 'allColumns' | 'indexes' | 'foreignKeys' | 'triggers';
export type DataSourceWriteOperation = 'exec' | 'begin' | 'commit' | 'rollback' | 'query';
export type DataSourceOperation = DataSourceReadOperation | DataSourceWriteOperation;
/** Only the selected connection is supplied. Never log this object. */
export interface DataSourceConfig { host: string; port: number; user: string; password: string; database: string; connectionParams?: string }
export interface DataSourceRequest {
  protocolVersion: 1 | 2; operation: DataSourceOperation; sessionId: string;
  config?: DataSourceConfig; database?: string; table?: string; query?: string; transactionId?: string;
}
/** Reports the affected-row count of one write statement. */
export interface DataSourceExecResult { rowsAffected: number }
/** Opaque provider transaction handle; at most 128 ASCII letters, digits, underscore or hyphen. */
export type DataSourceTransactionId = string;
/** bigint cells become strings. Numbers outside the safe integer range are rejected, not silently rounded. */
export interface DataSourceQueryResult { rows: Record<string, JSONValue | bigint>[]; fields: string[] }
export interface DataSourceColumnDefinition {
  name: string; type: string; nullable: string; key: string; default: string | null;
  hasDefault?: boolean; extra: string; comment: string; charset?: string; collation?: string;
}
export interface DataSourceColumnDefinitionWithTable { tableName: string; name: string; type: string; comment?: string }
export interface DataSourceIndexDefinition { name: string; columnName: string; nonUnique: number; seqInIndex: number; indexType: string; subPart?: number }
export interface DataSourceForeignKeyDefinition { name: string; columnName: string; refTableName: string; refColumnName: string; constraintName: string }
export interface DataSourceTriggerDefinition { name: string; timing: string; event: string; statement: string; orientation?: string }
export type DataSourceCallback<T> = (request: DataSourceRequest, signal: AbortSignal) => T | Promise<T>;
/** Callbacks can overlap; close must be idempotent for uncertain/late connect cleanup. */
export interface DataSourceOperations {
  connect?: DataSourceCallback<void>; ping?: DataSourceCallback<void>; close?: DataSourceCallback<void>;
  query?: DataSourceCallback<DataSourceQueryResult>;
  databases?: DataSourceCallback<string[]>; tables?: DataSourceCallback<string[]>;
  createStatement?: DataSourceCallback<string>;
  columns?: DataSourceCallback<DataSourceColumnDefinition[]>;
  allColumns?: DataSourceCallback<DataSourceColumnDefinitionWithTable[]>;
  indexes?: DataSourceCallback<DataSourceIndexDefinition[]>;
  foreignKeys?: DataSourceCallback<DataSourceForeignKeyDefinition[]>;
  triggers?: DataSourceCallback<DataSourceTriggerDefinition[]>;
  exec?: DataSourceCallback<DataSourceExecResult>;
  begin?: DataSourceCallback<DataSourceTransactionId>;
  commit?: DataSourceCallback<void>;
  rollback?: DataSourceCallback<void>;
}
