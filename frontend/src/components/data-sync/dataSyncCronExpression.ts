/**
 * Frontend port of the scheduler's Cron contract (`parseCronSchedule` in
 * `internal/syncjob/validation.go`). The backend owns scheduling; mirroring its
 * grammar here lets the editor block an expression the scheduler would reject,
 * instead of surfacing it only as a generic `definition_invalid` preflight
 * failure.
 *
 * Only the five-field form is accepted: minute hour day month weekday.
 */

export type DataSyncCronExpressionIssue =
  | 'cron_expression_field_count'
  | 'cron_expression_invalid';

type CronFieldBounds = { min: number; max: number };

/** Bounds per field position, in the order the expression is written. */
const CRON_FIELD_BOUNDS: readonly CronFieldBounds[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  // 7 and 0 both mean Sunday, matching the backend's normalizeSunday.
  { min: 0, max: 7 },
];

const CRON_INTEGER = /^[+-]?\d+$/;

const isCronInteger = (value: string): boolean => CRON_INTEGER.test(value);

/**
 * One field accepts a comma-separated list of `*`, `value`, `start-end`, or any
 * of those with a `/step` suffix.
 */
const isValidCronField = (spec: string, bounds: CronFieldBounds): boolean =>
  spec.split(',').every((rawItem) => {
    const item = rawItem.trim();
    if (!item) return false;
    let base = item;
    const slash = item.indexOf('/');
    if (slash >= 0) {
      base = item.slice(0, slash);
      const step = item.slice(slash + 1);
      if (!isCronInteger(step) || Number(step) <= 0) return false;
    }
    let start: number;
    let end: number;
    if (base === '*') {
      start = bounds.min;
      end = bounds.max;
    } else if (base.includes('-')) {
      const edge = base.split('-');
      if (edge.length !== 2) return false;
      if (!isCronInteger(edge[0]) || !isCronInteger(edge[1])) return false;
      start = Number(edge[0]);
      end = Number(edge[1]);
    } else {
      if (!isCronInteger(base)) return false;
      start = Number(base);
      end = start;
    }
    return start >= bounds.min && end <= bounds.max && start <= end;
  });

/**
 * Returns the validation code for an unacceptable expression, or null when the
 * backend scheduler would accept it.
 */
export const inspectDataSyncCronExpression = (
  expression: string,
): DataSyncCronExpressionIssue | null => {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) return 'cron_expression_field_count';
  const accepted = fields.every((field, index) =>
    isValidCronField(field, CRON_FIELD_BOUNDS[index]),
  );
  return accepted ? null : 'cron_expression_invalid';
};
