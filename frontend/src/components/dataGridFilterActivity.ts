import { parseListValues, type FilterCondition } from '../utils/sql';
import { normalizeQuickWhereCondition } from '../utils/dataGridWhereFilter';
import { parseMongoJSONValue } from '../utils/mongodb';

const NO_VALUE_OPERATORS = new Set(['IS_NULL', 'IS_NOT_NULL', 'IS_EMPTY', 'IS_NOT_EMPTY']);
const RANGE_OPERATORS = new Set(['BETWEEN', 'NOT_BETWEEN']);
const LIST_OPERATORS = new Set(['IN', 'NOT_IN']);

/**
 * MongoDB's CUSTOM branch throws unless the text evaluates to a JSON *object*:
 *
 *   const parsed = parseMongoJSONValue(expr);
 *   if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(...)
 *
 * A throwing condition is NOT treated as an effective filter here. The host surfaces
 * the error to the user and never runs the query, so lighting the toolbar entry would
 * claim "your data is filtered" for the exact case where the user just saw a failure.
 *
 * Note `parseMongoJSONValue` falls back to evaluating Mongo-like literals, so `{a:1}`
 * without quoted keys parses fine — this must reuse that helper rather than JSON.parse,
 * otherwise valid Mongo syntax would be misreported as ineffective.
 */
const mongoCustomProducesPredicate = (value: string): boolean => {
  let parsed: unknown;
  try {
    parsed = parseMongoJSONValue(value);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  // `{}` compiles to a match-all filter, i.e. the query is NOT narrowed.
  return Object.keys(parsed as Record<string, unknown>).length > 0;
};

/**
 * Whether a single condition actually produces a predicate.
 *
 * Mirrors the skip rules of the three runtime evaluators so the toolbar highlight
 * never claims a filter is active when the query would ignore that condition:
 * - utils/sql.ts buildWhereSQL
 * - utils/mongodb.ts buildMongoFilter
 * - utils/dataGridClientFilter filterRowsByGridConditions
 *
 * `dbType` only changes the verdict for MongoDB, where two inputs silently compile to
 * `{}` (a match-all filter) while SQL would still emit a WHERE clause:
 * - a CUSTOM expression that is not a JSON object (see mongoCustomProducesPredicate)
 * - a column-header value selection — buildMongoFilter has no valueSelection branch
 *
 * //DEBT: the second one is a missing feature in buildMongoFilter, not a deliberate rule.
 * Once it learns to translate valueSelection into $in/$or, drop the guard here.
 */
export const conditionProducesPredicate = (
  condition?: FilterCondition | null,
  dbType?: string,
): boolean => {
  if (!condition || condition.enabled === false) return false;

  const op = String(condition.op || '').trim();
  const column = String(condition.column || '').trim();
  const value = String(condition.value ?? '').trim();
  const isMongo = String(dbType || '').toLowerCase() === 'mongodb';

  // CUSTOM carries a raw predicate and needs no column name.
  if (op === 'CUSTOM') {
    if (value === '') return false;
    return isMongo ? mongoCustomProducesPredicate(value) : true;
  }

  if (!op || !column) return false;

  const selection = condition.valueSelection;
  if (selection) {
    if (isMongo) return false;
    return (selection.values || []).length > 0 || !!selection.includeNull || !!selection.includeEmpty;
  }

  if (NO_VALUE_OPERATORS.has(op)) return true;
  if (RANGE_OPERATORS.has(op)) {
    return value !== '' && String(condition.value2 ?? '').trim() !== '';
  }
  if (LIST_OPERATORS.has(op)) {
    return parseListValues(String(condition.value ?? '')).length > 0;
  }

  return value !== '';
};

/**
 * Highlight predicate for the toolbar filter entry.
 *
 * Reads the applied state only: `appliedFilterConditions` plus the normalized
 * quick-where. The draft state inside useDataGridFilters must never be used here,
 * because opening an empty filter panel injects a blank condition into the draft.
 *
 * `dbType` is optional purely to stay backward compatible for callers that only need
 * the SQL verdict; the toolbar always passes it.
 */
export const hasActiveGridFilters = (
  appliedConditions: FilterCondition[] | undefined,
  quickWhereCondition: unknown,
  dbType?: string,
): boolean => {
  if (normalizeQuickWhereCondition(quickWhereCondition)) return true;
  if (!Array.isArray(appliedConditions)) return false;
  return appliedConditions.some((condition) => conditionProducesPredicate(condition, dbType));
};
