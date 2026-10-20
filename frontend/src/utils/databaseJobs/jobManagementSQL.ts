import type { DatabaseJobRow } from '../../typeDefs/databaseJobTypes';
import { readDatabaseJobValue } from './jobMetadata';

export const sqlText = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL';
  const text = String(value);
  if (text.includes('\0')) throw new Error('database_jobs.manage.invalid_value');
  return `'${text.replace(/'/g, "''")}'`;
};
export const pgText = (value: unknown): string => value == null ? 'NULL' : `E${sqlText(String(value).replace(/\\/g, '\\\\'))}`;
export const numericID = (value: unknown): string => {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text)) throw new Error('database_jobs.manage.invalid_identity');
  return text;
};
export const guid = (value: string): string => {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new Error('database_jobs.manage.invalid_identity');
  return sqlText(value);
};
export const quotedName = (value: string): string => `"${value.replace(/"/g, '""')}"`;
export const qualifiedJob = (owner: string, name: string): string => sqlText([owner, name].filter(Boolean).map(quotedName).join('.'));
export const mysqlName = (value: string): string => `\`${value.replace(/`/g, '``')}\``;
export const mysqlText = (value: unknown): string => {
  const hex = Array.from(new TextEncoder().encode(String(value ?? '')), byte => byte.toString(16).padStart(2, '0')).join('');
  return hex ? `CONVERT(0x${hex} USING utf8mb4)` : "''";
};
export const value = (row: DatabaseJobRow, key: string): unknown => readDatabaseJobValue(row, key);
export const required = (row: DatabaseJobRow, key: string): unknown => {
  const result = value(row, key);
  if (result === undefined) throw new Error('database_jobs.manage.incomplete_metadata');
  return result;
};
export const numberValue = (v: unknown): string => {
  const text = String(v);
  if (!/^-?\d+$/.test(text)) throw new Error('database_jobs.manage.invalid_value');
  return text;
};
export const booleanValue = (v: unknown): string => ['true', 't', '1', 'y'].includes(String(v).toLowerCase()) ? 'TRUE' : 'FALSE';
export const plBlock = (statements: string[]): string => `BEGIN\n${statements.map(s => `  ${s};`).join('\n')}\nEND;`;
export const pgBlock = (statements: string[], declarations = ''): string => {
  const body = `${declarations ? `DECLARE\n${declarations}\n` : ''}BEGIN\n${statements.map(s => `  ${s};`).join('\n')}\nEND`;
  let tag = '$gonavi$';
  while (body.includes(tag)) tag = tag.replace('$gonavi', '$gonavi_');
  return `DO ${tag}\n${body}\n${tag};`;
};
export const requireCreate = (name: string): void => {
  if (!name.trim() || name.includes('\0')) throw new Error('database_jobs.manage.name_required');
};
