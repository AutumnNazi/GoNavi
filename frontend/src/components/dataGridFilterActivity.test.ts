import { describe, expect, it } from 'vitest';

import { conditionProducesPredicate, hasActiveGridFilters } from './dataGridFilterActivity';
import { buildWhereSQL, type FilterCondition } from '../utils/sql';
import { buildMongoFilter } from '../utils/mongodb';

const condition = (overrides: Partial<FilterCondition> = {}): FilterCondition => ({
  enabled: true,
  logic: 'AND',
  column: 'name',
  op: '=',
  value: 'alpha',
  ...overrides,
});

describe('conditionProducesPredicate', () => {
  it('rejects blank conditions', () => {
    expect(conditionProducesPredicate(undefined)).toBe(false);
    expect(conditionProducesPredicate(null)).toBe(false);
    expect(conditionProducesPredicate(condition({ value: '' }))).toBe(false);
    expect(conditionProducesPredicate(condition({ value: '   ' }))).toBe(false);
  });

  it('rejects disabled conditions even when they carry a value', () => {
    expect(conditionProducesPredicate(condition({ enabled: false, value: 'alpha' }))).toBe(false);
  });

  it('rejects conditions without a column unless the operator is CUSTOM', () => {
    expect(conditionProducesPredicate(condition({ column: '' }))).toBe(false);
    expect(conditionProducesPredicate(condition({ column: '', op: 'CUSTOM', value: 'status = 1' }))).toBe(true);
    expect(conditionProducesPredicate(condition({ column: '', op: 'CUSTOM', value: '' }))).toBe(false);
  });

  it('treats no-value operators as effective without a value', () => {
    ['IS_NULL', 'IS_NOT_NULL', 'IS_EMPTY', 'IS_NOT_EMPTY'].forEach((op) => {
      expect(conditionProducesPredicate(condition({ op, value: '' }))).toBe(true);
    });
  });

  it('requires both bounds for range operators', () => {
    expect(conditionProducesPredicate(condition({ op: 'BETWEEN', value: '1', value2: '' }))).toBe(false);
    expect(conditionProducesPredicate(condition({ op: 'BETWEEN', value: '1', value2: '9' }))).toBe(true);
    expect(conditionProducesPredicate(condition({ op: 'NOT_BETWEEN', value: '', value2: '9' }))).toBe(false);
  });

  it('requires a parseable list for list operators', () => {
    expect(conditionProducesPredicate(condition({ op: 'IN', value: ' , , ' }))).toBe(false);
    expect(conditionProducesPredicate(condition({ op: 'IN', value: 'a,b' }))).toBe(true);
    expect(conditionProducesPredicate(condition({ op: 'NOT_IN', value: '' }))).toBe(false);
  });

  it('counts value selections as effective regardless of the operator', () => {
    expect(conditionProducesPredicate(condition({ op: 'IN', value: '', valueSelection: { values: ['a'] } }))).toBe(true);
    expect(conditionProducesPredicate(condition({ op: '=', value: '', valueSelection: { values: [], includeNull: true } }))).toBe(true);
    expect(conditionProducesPredicate(condition({ op: '=', value: '', valueSelection: { values: [], includeEmpty: true } }))).toBe(true);
    expect(conditionProducesPredicate(condition({ op: '=', value: '', valueSelection: { values: [] } }))).toBe(false);
  });

  it('requires a value for every remaining value-carrying operator', () => {
    ['=', '!=', '<', '<=', '>', '>=', 'CONTAINS', 'NOT_CONTAINS', 'STARTS_WITH', 'ENDS_WITH'].forEach((op) => {
      expect(conditionProducesPredicate(condition({ op, value: '' }))).toBe(false);
      expect(conditionProducesPredicate(condition({ op, value: 'x' }))).toBe(true);
    });
  });

  it('stays aligned with buildWhereSQL on the shared operator matrix', () => {
    const cases: FilterCondition[] = [
      condition(),
      condition({ value: '' }),
      condition({ enabled: false }),
      condition({ column: '' }),
      condition({ op: 'CUSTOM', column: '', value: 'status = 1' }),
      condition({ op: 'CUSTOM', column: '', value: '' }),
      condition({ op: 'IS_NULL', value: '' }),
      condition({ op: 'IS_NOT_NULL', value: '' }),
      condition({ op: 'IS_EMPTY', value: '' }),
      condition({ op: 'IS_NOT_EMPTY', value: '' }),
      condition({ op: 'BETWEEN', value: '1', value2: '' }),
      condition({ op: 'BETWEEN', value: '1', value2: '9' }),
      condition({ op: 'IN', value: '' }),
      condition({ op: 'IN', value: 'a,b' }),
      condition({ op: 'CONTAINS', value: '' }),
      condition({ op: 'CONTAINS', value: 'x' }),
      condition({ op: 'IN', value: '', valueSelection: { values: ['a'] } }),
      condition({ op: '=', value: '', valueSelection: { values: [] } }),
    ];

    const mismatched = cases.filter((item) => (
      (buildWhereSQL('mysql', [item]) !== '') !== conditionProducesPredicate(item)
    ));

    expect(mismatched).toEqual([]);
  });
});

/**
 * MongoDB narrows nothing (compiles to `{}`) for two inputs that SQL would still turn
 * into a WHERE clause. Highlighting those would tell the user "your data is filtered"
 * while the server returns everything, so the verdict is dbType-aware.
 */
describe('conditionProducesPredicate (mongodb)', () => {
  const custom = (value: string) => condition({ op: 'CUSTOM', column: '', value });

  it('rejects a CUSTOM expression that is not a JSON object', () => {
    // buildMongoFilter throws for these; the host surfaces the error and runs nothing.
    expect(conditionProducesPredicate(custom('abc'), 'mongodb')).toBe(false);
    expect(conditionProducesPredicate(custom('1=1'), 'mongodb')).toBe(false);
    expect(conditionProducesPredicate(custom('[1,2]'), 'mongodb')).toBe(false);
    expect(conditionProducesPredicate(custom('null'), 'mongodb')).toBe(false);
    expect(conditionProducesPredicate(custom('true'), 'mongodb')).toBe(false);
  });

  it('rejects a CUSTOM expression that compiles to a match-all filter', () => {
    // `{}` is a valid JSON object, but it narrows nothing.
    expect(conditionProducesPredicate(custom('{}'), 'mongodb')).toBe(false);
    expect(conditionProducesPredicate(custom('  { }  '), 'mongodb')).toBe(false);
  });

  it('accepts a CUSTOM expression that yields a non-empty JSON object', () => {
    expect(conditionProducesPredicate(custom('{status:"A"}'), 'mongodb')).toBe(true);
    expect(conditionProducesPredicate(custom('{"status":"A"}'), 'mongodb')).toBe(true);
  });

  it('rejects a column value selection that buildMongoFilter silently drops', () => {
    const selection = condition({ op: 'IN', value: '', valueSelection: { values: ['A'] } });
    expect(conditionProducesPredicate(selection, 'mongodb')).toBe(false);
    // SQL still honors it, so the verdict must stay dbType-dependent.
    expect(conditionProducesPredicate(selection)).toBe(true);
    expect(conditionProducesPredicate(selection, 'mysql')).toBe(true);
  });

  it('keeps matching buildMongoFilter for every standard operator', () => {
    const matrix: Array<Partial<FilterCondition>> = [
      { op: '=' }, { op: '!=' }, { op: '<' }, { op: '<=' }, { op: '>' }, { op: '>=' },
      { op: 'CONTAINS' }, { op: 'NOT_CONTAINS' }, { op: 'STARTS_WITH' }, { op: 'NOT_STARTS_WITH' },
      { op: 'ENDS_WITH' }, { op: 'NOT_ENDS_WITH' }, { op: 'IS_NULL', value: '' },
      { op: 'IS_NOT_NULL', value: '' }, { op: 'IS_EMPTY', value: '' }, { op: 'IS_NOT_EMPTY', value: '' },
      { op: 'BETWEEN', value: 'a', value2: 'b' }, { op: 'NOT_BETWEEN', value: 'a', value2: 'b' },
      { op: 'IN', value: 'A,B' }, { op: 'NOT_IN', value: 'A,B' },
    ];

    matrix.forEach((overrides) => {
      const item = condition(overrides);
      const mongoProducesSomething = Object.keys(buildMongoFilter([item])).length > 0;
      expect(
        conditionProducesPredicate(item, 'mongodb'),
        `mongodb mismatch for ${String(overrides.op)}`,
      ).toBe(mongoProducesSomething);
    });
  });
});

describe('hasActiveGridFilters', () => {
  it('stays inactive when nothing is applied', () => {
    expect(hasActiveGridFilters([], '')).toBe(false);
    expect(hasActiveGridFilters(undefined, undefined)).toBe(false);
  });

  it('stays inactive for the blank condition injected when the panel opens', () => {
    expect(hasActiveGridFilters([condition({ value: '', value2: '' })], '')).toBe(false);
  });

  it('stays inactive when every applied condition is disabled', () => {
    expect(hasActiveGridFilters([
      condition({ enabled: false }),
      condition({ enabled: false, column: 'title' }),
    ], '')).toBe(false);
  });

  it('activates when at least one applied condition is effective', () => {
    expect(hasActiveGridFilters([
      condition({ enabled: false }),
      condition({ column: 'title' }),
    ], '')).toBe(true);
  });

  it('activates for a normalized quick-where on its own', () => {
    expect(hasActiveGridFilters([], ' WHERE status = 1; ')).toBe(true);
  });

  it('ignores blank or WHERE-only quick-where drafts', () => {
    expect(hasActiveGridFilters([], '   ')).toBe(false);
    expect(hasActiveGridFilters([], 'where')).toBe(false);
    expect(hasActiveGridFilters([], null)).toBe(false);
  });

  it('ignores a disabled condition beside an empty quick-where', () => {
    expect(hasActiveGridFilters([condition({ enabled: false })], '  ')).toBe(false);
  });
});
