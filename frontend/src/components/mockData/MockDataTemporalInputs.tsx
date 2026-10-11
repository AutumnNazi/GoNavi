import React from 'react';
import { DatePicker, TimePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import type { MockDataGenerator } from './mockDataModel';

dayjs.extend(customParseFormat);

/** 与后端 internal/mockdata 的文本格式一致。 */
export const MOCK_DATA_TEMPORAL_FORMATS = {
  date: 'YYYY-MM-DD',
  time: 'HH:mm:ss',
  datetime: 'YYYY-MM-DD HH:mm:ss',
} as const;

type TemporalMode = keyof typeof MOCK_DATA_TEMPORAL_FORMATS;

export const parseMockDataTemporal = (value: string | undefined, mode: TemporalMode): Dayjs | null => {
  if (!value) return null;
  const parsed = dayjs(value, MOCK_DATA_TEMPORAL_FORMATS[mode], true);
  return parsed.isValid() ? parsed : null;
};

export const formatMockDataTemporal = (value: Dayjs | null | undefined, mode: TemporalMode): string => (
  value ? value.format(MOCK_DATA_TEMPORAL_FORMATS[mode]) : ''
);

const modeOfKind = (kind: MockDataGenerator['kind']): TemporalMode => {
  if (kind === 'date_range') return 'date';
  if (kind === 'time_range') return 'time';
  return 'datetime';
};

export type MockDataTemporalRangeProps = {
  generator: MockDataGenerator;
  disabled: boolean;
  placeholders: [string, string];
  onChange: (patch: Partial<MockDataGenerator>) => void;
};

/** 日期 / 时间 / 日期时间区间选择器；值仍以文本存进计划。 */
export const MockDataTemporalRange: React.FC<MockDataTemporalRangeProps> = ({ generator, disabled, placeholders, onChange }) => {
  const mode = modeOfKind(generator.kind);
  const value: [Dayjs | null, Dayjs | null] = [parseMockDataTemporal(generator.min, mode), parseMockDataTemporal(generator.max, mode)];
  const handleChange = (range: [Dayjs | null, Dayjs | null] | null) => {
    onChange({ min: formatMockDataTemporal(range?.[0], mode), max: formatMockDataTemporal(range?.[1], mode) });
  };
  if (mode === 'time') {
    return (
      <TimePicker.RangePicker size="small" disabled={disabled} value={value} format={MOCK_DATA_TEMPORAL_FORMATS.time}
        placeholder={placeholders} allowClear={false} onChange={handleChange} />
    );
  }
  return (
    <DatePicker.RangePicker size="small" disabled={disabled} value={value} format={MOCK_DATA_TEMPORAL_FORMATS[mode]}
      showTime={mode === 'datetime'} placeholder={placeholders} allowClear={false} onChange={handleChange} />
  );
};

export type MockDataDateTimeStartProps = {
  value: string | undefined;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
};

/** 递增时间的起点。 */
export const MockDataDateTimeStart: React.FC<MockDataDateTimeStartProps> = ({ value, disabled, placeholder, onChange }) => (
  <DatePicker size="small" showTime disabled={disabled} value={parseMockDataTemporal(value, 'datetime')}
    format={MOCK_DATA_TEMPORAL_FORMATS.datetime} placeholder={placeholder} allowClear={false}
    onChange={(next) => onChange(formatMockDataTemporal(next, 'datetime'))} />
);
