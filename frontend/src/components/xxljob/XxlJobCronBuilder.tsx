// Cron 表达式构建器：对齐官方 xxl-job cronGen 的七个页签（秒/分/时/日/月/周/年）
// 与各页签模式（每单位/周期/起始步进/指定/不指定）。纯函数 + 受控组件，无新依赖。
import React, { useEffect, useMemo, useState } from 'react';
import { Checkbox, Input, Radio, Select, Tabs } from 'antd';
import { t } from '../../i18n';

export type CronFieldKey = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'week' | 'year';

// 各字段的取值范围（与 Quartz cron 一致）。
const FIELD_RANGE: Record<CronFieldKey, { min: number; max: number }> = {
  second: { min: 0, max: 59 },
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  day: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  week: { min: 1, max: 7 },
  year: { min: 1970, max: 2099 },
};

// 周字段的 1-7 在 Quartz 里是 SUN-SAT。
const WEEK_NAMES = ['', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_NAMES = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// 每个字段的模式。value 是模式 id，构建时按字段名 + 模式拼表达式。
type FieldMode = 'every' | 'unassign' | 'range' | 'step' | 'assign' | 'last' | 'lastOffset' | 'workDay' | 'nthWeek' | 'lastWeek';

const MODES_BY_FIELD: Record<CronFieldKey, FieldMode[]> = {
  second: ['every', 'range', 'step', 'assign'],
  minute: ['every', 'range', 'step', 'assign'],
  hour: ['every', 'range', 'step', 'assign'],
  day: ['every', 'unassign', 'range', 'step', 'assign', 'last', 'lastOffset', 'workDay'],
  month: ['every', 'range', 'step', 'assign'],
  week: ['every', 'unassign', 'range', 'step', 'assign', 'nthWeek', 'lastWeek'],
  year: ['every', 'range', 'step', 'assign'],
};

// 官方默认：秒分每单位、时不指定、日月年每单位、周不指定、年每单位。
const DEFAULT_PARTS: Record<CronFieldKey, string> = {
  second: '*',
  minute: '*',
  hour: '?',
  day: '?',
  month: '*',
  week: '?',
  year: '*',
};

// 模式 → 表达式片段。
const buildPart = (field: CronFieldKey, mode: FieldMode, state: FieldState): string => {
  const { min, max } = FIELD_RANGE[field];
  const range = (n: number) => field === 'week' && n >= 1 && n <= 7 ? WEEK_NAMES[n] : String(n);
  switch (mode) {
    case 'every':
      return '*';
    case 'unassign':
      return '?';
    case 'range':
      return `${range(state.rangeStart ?? min)}-${range(state.rangeEnd ?? max)}`;
    case 'step':
      return `${range(state.stepStart ?? min)}/${state.stepEvery ?? 1}`;
    case 'assign': {
      const picked = state.assign.filter((n) => n >= min && n <= max).sort((a, b) => a - b);
      if (picked.length === 0 || picked.length === (max - min + 1)) return '*';
      return picked.map(range).join(',');
    }
    case 'last':
      return 'L';
    case 'lastOffset':
      return `L-${state.lastOffset ?? 1}`;
    case 'workDay':
      return `${state.workDay ?? 1}W`;
    case 'nthWeek':
      return `${WEEK_NAMES[state.nthWeekDay ?? 1]}#${state.nthWeekIndex ?? 1}`;
    case 'lastWeek':
      return `${WEEK_NAMES[state.nthWeekDay ?? 1]}L`;
    default:
      return '*';
  }
};

type FieldState = {
  mode: FieldMode;
  rangeStart?: number;
  rangeEnd?: number;
  stepStart?: number;
  stepEvery?: number;
  assign: number[];
  lastOffset?: number;
  workDay?: number;
  nthWeekDay?: number;
  nthWeekIndex?: number;
};

const emptyField = (field: CronFieldKey): FieldState => ({
  mode: MODES_BY_FIELD[field][0],
  assign: [],
  rangeStart: FIELD_RANGE[field].min,
  rangeEnd: FIELD_RANGE[field].min + 1,
  stepStart: FIELD_RANGE[field].min,
  stepEvery: 1,
  lastOffset: 1,
  workDay: 1,
  nthWeekDay: 1,
  nthWeekIndex: 1,
});

// 从现有表达式解析回字段状态（尽力解析；不认识的片段保持默认）。
export const parseCronExpression = (expression: string): Record<CronFieldKey, FieldState> => {
  const parts = expression.trim().split(/\s+/);
  const keys: CronFieldKey[] = ['second', 'minute', 'hour', 'day', 'month', 'week', 'year'];
  const fields = {} as Record<CronFieldKey, FieldState>;
  keys.forEach((key, index) => {
    const part = parts[index] ?? DEFAULT_PARTS[key];
    fields[key] = parsePart(key, part);
  });
  return fields;
};

const parsePart = (field: CronFieldKey, part: string): FieldState => {
  const base = emptyField(field);
  const { min, max } = FIELD_RANGE[field];
  if (part === '*' || part === '0/1') {
    base.mode = 'every';
    return base;
  }
  if (part === '?') {
    base.mode = 'unassign';
    return base;
  }
  if (part === 'L') {
    base.mode = 'last';
    return base;
  }
  const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
  if (rangeMatch) {
    base.mode = 'range';
    base.rangeStart = Number(rangeMatch[1]);
    base.rangeEnd = Number(rangeMatch[2]);
    return base;
  }
  const stepMatch = /^(\d+)\/(\d+)$/.exec(part);
  if (stepMatch) {
    base.mode = 'step';
    base.stepStart = Number(stepMatch[1]);
    base.stepEvery = Number(stepMatch[2]);
    return base;
  }
  const lastOffsetMatch = /^L-(\d+)$/.exec(part);
  if (lastOffsetMatch) {
    base.mode = 'lastOffset';
    base.lastOffset = Number(lastOffsetMatch[1]);
    return base;
  }
  const workDayMatch = /^(\d+)W$/.exec(part);
  if (workDayMatch) {
    base.mode = 'workDay';
    base.workDay = Number(workDayMatch[1]);
    return base;
  }
  const nthWeekMatch = /^([0-7])#(\d+)$/.exec(part) ?? /^([A-Z]{3})#(\d+)$/.exec(part);
  if (nthWeekMatch) {
    base.mode = 'nthWeek';
    base.nthWeekDay = Number(nthWeekMatch[1]) || WEEK_NAMES.indexOf(nthWeekMatch[1]);
    base.nthWeekIndex = Number(nthWeekMatch[2]);
    return base;
  }
  const lastWeekMatch = /^([0-7A-Z]{1,3})L$/.exec(part);
  if (lastWeekMatch && field === 'week') {
    base.mode = 'lastWeek';
    base.nthWeekDay = Number(lastWeekMatch[1]) || WEEK_NAMES.indexOf(lastWeekMatch[1]);
    return base;
  }
  const assignItems = part.split(',').map((item) => {
    const numeric = Number(item);
    if (Number.isFinite(numeric)) return numeric;
    const weekIndex = WEEK_NAMES.indexOf(item);
    if (weekIndex > 0) return weekIndex;
    const monthIndex = MONTH_NAMES.indexOf(item);
    if (monthIndex > 0) return monthIndex;
    return NaN;
  }).filter((n) => Number.isFinite(n) && n >= min && n <= max);
  if (assignItems.length > 0) {
    base.mode = 'assign';
    base.assign = assignItems;
  }
  return base;
};

// 字段状态 → cron 表达式（七段）。
export const buildCronExpression = (fields: Record<CronFieldKey, FieldState>): string => {
  const keys: CronFieldKey[] = ['second', 'minute', 'hour', 'day', 'month', 'week', 'year'];
  const parts = keys.map((key) => buildPart(key, fields[key].mode, fields[key]));
  // Quartz 约束：day 与 week 不能同时指定——一方指定时另一方必须是 ?。
  if (parts[3] !== '?' && parts[5] !== '?') {
    parts[5] = '?';
  }
  // 两者都未指定时，day 回退 *。
  if (parts[3] === '?' && parts[5] === '?') {
    parts[3] = '*';
  }
  // year 段为默认 * 时省略（官方 cronGen 输出六段；year 仅在明确指定时保留）。
  if (parts.length === 7 && parts[6] === '*') {
    parts.pop();
  }
  return parts.join(' ');
};

// 单字段编辑器：模式单选 + 参数输入。
const FieldEditor: React.FC<{
  field: CronFieldKey;
  state: FieldState;
  onChange: (next: FieldState) => void;
}> = ({ field, state, onChange }) => {
  const { min, max } = FIELD_RANGE[field];
  const options = state.assign.map(String);
  const label = (mode: FieldMode) => t(`xxljob.cron.mode.${mode}`);

  const numberInput = (key: keyof Omit<FieldState, 'mode' | 'assign'>, value: number | undefined, limits?: { min: number; max: number }) => (
    <Input
      type="number"
      style={{ width: 72, margin: '0 6px' }}
      value={value ?? ''}
      min={limits?.min ?? min}
      max={limits?.max ?? max}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (!Number.isFinite(next)) return;
        onChange({ ...state, [key]: next });
      }}
    />
  );

  return (
    <Radio.Group
      value={state.mode}
      onChange={(event) => onChange({ ...state, mode: event.target.value as FieldMode })}
    >
      <div className="xxljob-cron-modes">
        {MODES_BY_FIELD[field].includes('every') ? (
          <Radio value="every">{label('every')}</Radio>
        ) : null}
        {MODES_BY_FIELD[field].includes('unassign') ? (
          <Radio value="unassign">{label('unassign')}</Radio>
        ) : null}
        {MODES_BY_FIELD[field].includes('range') ? (
          <Radio value="range" className="xxljob-cron-mode-inline">
            {label('range')}
            {numberInput('rangeStart', state.rangeStart)}
            <span className="xxljob-cron-sep">-</span>
            {numberInput('rangeEnd', state.rangeEnd)}
          </Radio>
        ) : null}
        {MODES_BY_FIELD[field].includes('step') ? (
          <Radio value="step" className="xxljob-cron-mode-inline">
            {label('step')}
            {numberInput('stepStart', state.stepStart)}
            <span className="xxljob-cron-sep">/</span>
            {numberInput('stepEvery', state.stepEvery, { min: 1, max: max })}
          </Radio>
        ) : null}
        {MODES_BY_FIELD[field].includes('last') ? (
          <Radio value="last">{label('last')}</Radio>
        ) : null}
        {MODES_BY_FIELD[field].includes('lastOffset') ? (
          <Radio value="lastOffset" className="xxljob-cron-mode-inline">
            {label('lastOffset')}
            {numberInput('lastOffset', state.lastOffset, { min: 1, max: 31 })}
          </Radio>
        ) : null}
        {MODES_BY_FIELD[field].includes('workDay') ? (
          <Radio value="workDay" className="xxljob-cron-mode-inline">
            {label('workDay')}
            {numberInput('workDay', state.workDay)}
            <span className="xxljob-cron-sep">W</span>
          </Radio>
        ) : null}
        {MODES_BY_FIELD[field].includes('nthWeek') ? (
          <Radio value="nthWeek" className="xxljob-cron-mode-inline">
            {label('nthWeek')}
            <Select
              size="small"
              style={{ width: 84, margin: '0 4px' }}
              value={state.nthWeekDay ?? 1}
              onChange={(next) => onChange({ ...state, nthWeekDay: Number(next) })}
              options={WEEK_NAMES.slice(1).map((name, index) => ({ label: name, value: index + 1 }))}
            />
            {t('xxljob.cron.mode.nthWeekIndex')}
            {numberInput('nthWeekIndex', state.nthWeekIndex, { min: 1, max: 5 })}
          </Radio>
        ) : null}
        {MODES_BY_FIELD[field].includes('lastWeek') ? (
          <Radio value="lastWeek" className="xxljob-cron-mode-inline">
            {label('lastWeek')}
            <Select
              size="small"
              style={{ width: 84, margin: '0 4px' }}
              value={state.nthWeekDay ?? 1}
              onChange={(next) => onChange({ ...state, nthWeekDay: Number(next) })}
              options={WEEK_NAMES.slice(1).map((name, index) => ({ label: name, value: index + 1 }))}
            />
          </Radio>
        ) : null}
        {MODES_BY_FIELD[field].includes('assign') ? (
          <Radio value="assign" className="xxljob-cron-mode-assign">
            {label('assign')}
            <Checkbox.Group
              className="xxljob-cron-assign-grid"
              value={options}
              onChange={(next) => onChange({ ...state, assign: (next as string[]).map(Number).sort((a, b) => a - b) })}
              options={Array.from({ length: max - min + 1 }, (_, index) => {
                const value = min + index;
                return {
                  label: field === 'week' ? WEEK_NAMES[value] : (field === 'month' ? MONTH_NAMES[value] : String(value).padStart(2, '0')),
                  value: String(value),
                };
              })}
            />
          </Radio>
        ) : null}
      </div>
    </Radio.Group>
  );
};

// Cron 构建器：受控 value（七段表达式）。
export const XxlJobCronBuilder: React.FC<{
  value: string;
  onChange: (next: string) => void;
}> = ({ value, onChange }) => {
  const [fields, setFields] = useState(() => parseCronExpression(value || '0 0 0 * * ?'));

  // 外部值变化（如编辑回填）时重新解析。
  useEffect(() => {
    setFields(parseCronExpression(value || '0 0 0 * * ?'));
  }, [value]);

  const update = (key: CronFieldKey, next: FieldState) => {
    const merged = { ...fields, [key]: next };
    setFields(merged);
    onChange(buildCronExpression(merged));
  };

  const tabs = useMemo(() => (['second', 'minute', 'hour', 'day', 'month', 'week', 'year'] as CronFieldKey[]).map((key) => ({
    key,
    label: t(`xxljob.cron.field.${key}`),
    children: <FieldEditor field={key} state={fields[key]} onChange={(next) => update(key, next)} />,
  })), [fields]);

  return (
    <Tabs
      size="small"
      items={tabs}
      style={{ marginTop: 4 }}
    />
  );
};

export default XxlJobCronBuilder;
