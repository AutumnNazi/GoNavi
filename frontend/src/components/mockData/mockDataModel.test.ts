import { describe, expect, it } from 'vitest';
import {
  buildDefaultMockDataGenerator,
  resolveMockDataCapacity,
  resolveMockDataLocale,
  switchMockDataGeneratorKind,
  type MockDataProfile,
} from './mockDataModel';

const profile = (patch: Partial<MockDataProfile>): MockDataProfile => ({
  name: 'c',
  type: 'varchar(30)',
  category: 'string',
  nullable: true,
  hasDefault: false,
  autoIncrement: false,
  computed: false,
  primaryKey: false,
  unique: false,
  ...patch,
});

describe('mockDataModel', () => {
  const now = new Date(2026, 9, 8, 12, 0, 0);

  it('clamps default numeric ranges to the column type', () => {
    expect(buildDefaultMockDataGenerator('int_range', profile({ category: 'integer', min: '-128', max: '127' }), 'zh', now))
      .toEqual({ kind: 'int_range', min: '1', max: '127' });
    expect(buildDefaultMockDataGenerator('decimal_range', profile({ category: 'decimal', min: '-9.99', max: '9.99', scale: 2 }), 'zh', now))
      .toEqual({ kind: 'decimal_range', min: '0', max: '9.99', scale: 2 });
  });

  it('counts Chinese as three bytes in byte-length columns', () => {
    const oracleVarchar = profile({ maxLength: 30, lengthInBytes: true });
    expect(resolveMockDataCapacity(oracleVarchar, true)).toBe(10);
    expect(resolveMockDataCapacity(oracleVarchar, false)).toBe(30);
    expect(buildDefaultMockDataGenerator('text', oracleVarchar, 'zh', now)).toMatchObject({ minLength: 10, maxLength: 10 });
    expect(buildDefaultMockDataGenerator('random_string', oracleVarchar, 'zh', now)).toMatchObject({ minLength: 8, maxLength: 16 });
  });

  it('uses the backend suggestion when switching back to the suggested rule', () => {
    const suggested = { kind: 'sequence' as const, start: '501', step: '1' };
    expect(switchMockDataGeneratorKind('sequence', profile({ category: 'integer' }), 'en', suggested)).toEqual(suggested);
    expect(switchMockDataGeneratorKind('datetime_range', profile({ category: 'datetime' }), 'en', suggested).kind).toBe('datetime_range');
    expect(buildDefaultMockDataGenerator('sequence', profile({ category: 'integer', nextValue: '42' }), 'en', now).start).toBe('42');
  });

  it('maps UI language to generator locale', () => {
    expect(resolveMockDataLocale('zh-CN')).toBe('zh');
    expect(resolveMockDataLocale('zh-TW')).toBe('zh');
    expect(resolveMockDataLocale('ja-JP')).toBe('en');
  });
});
