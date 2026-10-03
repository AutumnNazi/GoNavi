import { describe, expect, it } from 'vitest';

import {
  isNumericGridColumnType,
  normalizeGridColumnTypeForAlign,
  resolveGridColumnAlign,
} from './dataGridColumnAlign';

describe('normalizeGridColumnTypeForAlign', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeGridColumnTypeForAlign('  DECIMAL(10, 2) ')).toBe('decimal(10, 2)');
    expect(normalizeGridColumnTypeForAlign('BIGINT\n  UNSIGNED')).toBe('bigint unsigned');
  });

  it('unwraps nullable and lowcardinality wrappers', () => {
    expect(normalizeGridColumnTypeForAlign('Nullable(Int32)')).toBe('int32');
    expect(normalizeGridColumnTypeForAlign('LowCardinality(Nullable(String))')).toBe('string');
  });

  it('keeps empty and non-wrapped types as-is', () => {
    expect(normalizeGridColumnTypeForAlign(undefined)).toBe('');
    expect(normalizeGridColumnTypeForAlign(null)).toBe('');
    expect(normalizeGridColumnTypeForAlign('')).toBe('');
    expect(normalizeGridColumnTypeForAlign('varchar(255)')).toBe('varchar(255)');
  });
});

describe('isNumericGridColumnType', () => {
  it.each([
    ['int', true],
    ['bigint', true],
    ['bigint unsigned', true],
    ['tinyint(1)', true],
    ['decimal(10,2)', true],
    ['numeric(8, 3)', true],
    ['double precision', true],
    ['float8', true],
    ['number', true],
    ['NUMBER(10,2)', true],
    ['binary_double', true],
    ['money', true],
    ['serial', true],
    ['bigserial', true],
    ['Nullable(Int32)', true],
    ['Nullable(Decimal(18, 2))', true],
    ['UInt64', true],
    ['Int256', true],
    ['hugeint', true],
  ])('treats %s as numeric', (columnType, expected) => {
    expect(isNumericGridColumnType(columnType)).toBe(expected);
  });

  it.each([
    ['varchar(255)', false],
    ['text', false],
    ['boolean', false],
    ['bool', false],
    ['bit', false],
    ['bit varying', false],
    ['json', false],
    ['jsonb', false],
    ['uuid', false],
    ['interval', false],
    ['int4range', false],
    ['datetime', false],
    ['', false],
    [undefined, false],
  ])('treats %s as non-numeric', (columnType, expected) => {
    expect(isNumericGridColumnType(columnType)).toBe(expected);
  });
});

describe('resolveGridColumnAlign', () => {
  it('right-aligns numeric columns', () => {
    expect(resolveGridColumnAlign('bigint')).toBe('right');
    expect(resolveGridColumnAlign('decimal(10,2)')).toBe('right');
    expect(resolveGridColumnAlign('double')).toBe('right');
  });

  it('right-aligns date/time columns', () => {
    expect(resolveGridColumnAlign('datetime')).toBe('right');
    expect(resolveGridColumnAlign('timestamp(6)')).toBe('right');
    expect(resolveGridColumnAlign('date')).toBe('right');
    expect(resolveGridColumnAlign('time')).toBe('right');
    expect(resolveGridColumnAlign('year')).toBe('right');
    expect(resolveGridColumnAlign('Nullable(DateTime)')).toBe('right');
  });

  it('right-aligns Oracle DATE the same as the inline editor picker', () => {
    expect(resolveGridColumnAlign('date', 'oracle')).toBe('right');
    expect(resolveGridColumnAlign('date', 'mysql')).toBe('right');
  });

  it.each([
    ['varchar(255)'],
    ['text'],
    ['boolean'],
    ['bool'],
    ['bit'],
    ['json'],
    ['uuid'],
  ])('left-aligns %s columns', (columnType) => {
    expect(resolveGridColumnAlign(columnType)).toBe('left');
  });

  it('falls back to left for unknown or missing types', () => {
    expect(resolveGridColumnAlign('')).toBe('left');
    expect(resolveGridColumnAlign(undefined)).toBe('left');
    expect(resolveGridColumnAlign('weird_custom_type')).toBe('left');
  });
});
