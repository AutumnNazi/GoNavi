import type { DatabaseJobKind } from '../../typeDefs/databaseJobTypes';

export type DatabaseJobQueryGroup = {
  kind: DatabaseJobKind;
  queries: string[];
  /** Successful absence is different from an unreadable catalog. Never install extensions here. */
  probeQueries?: string[];
};

export type DatabaseJobChildQueries = { steps?: string[]; schedules?: string[] };

export const jobLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
export const isJobID = (value: string): boolean => /^\d+$/.test(value);

export const postgresJobCatalogProbe = (schema: string, table: string): string => (
  `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${jobLiteral(schema)} AND c.relname = ${jobLiteral(table)}) AS available`
);
