import React from 'react';
import { Input, InputNumber, Select, Switch } from 'antd';
import { MockDataDateTimeStart, MockDataTemporalRange } from './MockDataTemporalInputs';
import {
  MOCK_DATA_CHARSETS,
  MOCK_DATA_KIND_PARAMS,
  type MockDataColumnInfo,
  type MockDataGenerator,
  type MockDataParamKey,
} from './mockDataModel';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export type MockDataGeneratorParamsProps = {
  info: MockDataColumnInfo;
  generator: MockDataGenerator;
  disabled: boolean;
  onChange: (patch: Partial<MockDataGenerator>) => void;
  t: Translate;
};

const TEMPORAL_RANGE_KINDS = new Set<MockDataGenerator['kind']>(['date_range', 'time_range', 'datetime_range']);

const temporalPlaceholders = (kind: MockDataGenerator['kind']): [string, string] => {
  switch (kind) {
    case 'date_range':
      return ['2026-01-01', '2026-12-31'];
    case 'time_range':
      return ['08:00:00', '20:00:00'];
  }
  return ['2026-01-01 00:00:00', '2026-12-31 23:59:59'];
};

const isStringCategory = (info: MockDataColumnInfo): boolean => (
  info.profile.category === 'string' || info.profile.category === 'text'
);

/** 一个带标签的参数：标签是普通文字，与输入框分开，多个参数之间留间距。 */
const ParamField: React.FC<{ label?: string; children: React.ReactNode }> = ({ label, children }) => (
  <span className="gn-mock-data-param-field">
    {label ? <span className="gn-mock-data-param-label">{label}</span> : null}
    {children}
  </span>
);

const RangeSeparator = () => <span className="gn-mock-data-param-separator">~</span>;

/** 区间：日期类用选择器，数值类用两个输入框。 */
const renderRangeParam = (props: MockDataGeneratorParamsProps): React.ReactNode => {
  const { generator, disabled, onChange, t } = props;
    if (TEMPORAL_RANGE_KINDS.has(generator.kind)) {
      return (
        <ParamField label={t('mock_data.param.range')}>
          <MockDataTemporalRange generator={generator} disabled={disabled} placeholders={temporalPlaceholders(generator.kind)} onChange={onChange} />
        </ParamField>
      );
    }
    return (
      <ParamField label={t('mock_data.param.range')}>
        <Input size="small" value={generator.min} placeholder={t('mock_data.param.min')} onChange={(event) => onChange({ min: event.target.value })} style={{ width: 120 }} />
        <RangeSeparator />
        <Input size="small" value={generator.max} placeholder={t('mock_data.param.max')} onChange={(event) => onChange({ max: event.target.value })} style={{ width: 120 }} />
      </ParamField>
    );
};

/** 序列类：数值序列、带前缀的编号、递增时间。 */
const renderSequenceParam = (key: MockDataParamKey, props: MockDataGeneratorParamsProps): React.ReactNode => {
  const { info, generator, disabled, onChange, t } = props;
  switch (key) {
    case 'sequence':
      return (
        <>
          <ParamField label={t('mock_data.param.start')}>
            <Input size="small" value={generator.start} onChange={(event) => onChange({ start: event.target.value })} style={{ width: 120 }} />
          </ParamField>
          <ParamField label={t('mock_data.param.step')}>
            <Input size="small" value={generator.step} onChange={(event) => onChange({ step: event.target.value })} style={{ width: 64 }} />
          </ParamField>
        </>
      );
    case 'prefix':
      if (!isStringCategory(info)) return null;
      return (
        <>
          <ParamField label={t('mock_data.param.prefix')}>
            <Input size="small" value={generator.prefix} onChange={(event) => onChange({ prefix: event.target.value })} style={{ width: 90 }} />
          </ParamField>
          <ParamField label={t('mock_data.param.width')}>
            <InputNumber size="small" min={0} max={30} value={generator.width ?? 0} onChange={(value) => onChange({ width: Number(value ?? 0) })} style={{ width: 64 }} />
          </ParamField>
        </>
      );
    case 'datetimeSequence':
      return (
        <>
          <ParamField label={t('mock_data.param.start')}>
            <MockDataDateTimeStart value={generator.start} disabled={disabled} placeholder="2026-01-01 00:00:00"
              onChange={(start) => onChange({ start })} />
          </ParamField>
          <ParamField label={t('mock_data.param.step_seconds')}>
            <Input size="small" value={generator.step} onChange={(event) => onChange({ step: event.target.value })} style={{ width: 72 }} />
          </ParamField>
        </>
      );
  }
  return null;
};

/** 渲染单个参数输入。 */
const renderMockDataParam = (key: MockDataParamKey, props: MockDataGeneratorParamsProps): React.ReactNode => {
  const { info, generator, disabled, onChange, t } = props;
  switch (key) {
    case 'value':
      return (
        <ParamField label={t('mock_data.param.value')}>
          <Input size="small" value={generator.value} onChange={(event) => onChange({ value: event.target.value })} style={{ width: 200 }} />
        </ParamField>
      );
    case 'values':
      return (
        <ParamField label={t('mock_data.param.candidates')}>
          <Select size="small" mode="tags" tokenSeparators={[',', '\n']} value={generator.values || []} open={false}
            placeholder={t('mock_data.param.values')} onChange={(values: string[]) => onChange({ values })} style={{ minWidth: 240 }} />
        </ParamField>
      );
    case 'enumValues':
      return (
        <ParamField label={t('mock_data.param.candidates')}>
          <Select size="small" mode="multiple" value={generator.values || []} placeholder={t('mock_data.param.enum_all')}
            options={(info.profile.enumValues || []).map((label) => ({ value: label, label }))}
            onChange={(values: string[]) => onChange({ values })} style={{ minWidth: 240 }} />
        </ParamField>
      );
    case 'range':
      return renderRangeParam(props);
    case 'sequence':
    case 'prefix':
    case 'datetimeSequence':
      return renderSequenceParam(key, props);
    case 'scale':
      return (
        <ParamField label={t('mock_data.param.scale')}>
          <InputNumber size="small" min={0} max={info.profile.scale || 10} value={generator.scale ?? 0}
            onChange={(value) => onChange({ scale: Number(value ?? 0) })} style={{ width: 64 }} />
        </ParamField>
      );
    case 'length':
      return (
        <ParamField label={t('mock_data.param.length')}>
          <InputNumber size="small" min={1} value={generator.minLength} onChange={(value) => onChange({ minLength: Number(value ?? 1) })} style={{ width: 72 }} />
          <RangeSeparator />
          <InputNumber size="small" min={1} value={generator.maxLength} onChange={(value) => onChange({ maxLength: Number(value ?? 1) })} style={{ width: 72 }} />
        </ParamField>
      );
    case 'charset':
      return (
        <ParamField label={t('mock_data.param.charset')}>
          <Select size="small" value={generator.charset || 'alnum'} style={{ width: 130 }}
            options={MOCK_DATA_CHARSETS.filter((charset) => !(info.profile.asciiOnly && charset === 'chinese'))
              .map((charset) => ({ value: charset, label: t(`mock_data.charset.${charset}`) }))}
            onChange={(charset: string) => onChange({ charset })} />
        </ParamField>
      );
    case 'ratio':
      return (
        <ParamField label={t('mock_data.param.true_ratio')}>
          <InputNumber size="small" min={0} max={100} step={10} value={Math.round((generator.ratio ?? 0.5) * 100)}
            onChange={(value) => onChange({ ratio: Math.min(Math.max(Number(value ?? 50), 0), 100) / 100 })} style={{ width: 72 }} />
          <span className="gn-mock-data-param-label">%</span>
        </ParamField>
      );
    case 'locale':
      return (
        <ParamField label={t('mock_data.param.language')}>
          <Select size="small" value={generator.locale || 'zh'} style={{ width: 88 }}
            options={[
              { value: 'zh', label: t('mock_data.locale.zh'), disabled: info.profile.asciiOnly === true },
              { value: 'en', label: t('mock_data.locale.en') },
            ]}
            onChange={(locale: 'zh' | 'en') => onChange({ locale })} />
        </ParamField>
      );
    case 'compact':
      return (
        <ParamField label={t('mock_data.param.compact')}>
          <Switch size="small" checked={generator.compact === true} onChange={(compact) => onChange({ compact })} />
        </ParamField>
      );
  }
  return null;
};

/** 生成规则的参数输入；每种规则显示哪些参数见 MOCK_DATA_KIND_PARAMS。 */
export const MockDataGeneratorParams: React.FC<MockDataGeneratorParamsProps> = (props) => {
  const { info, generator, disabled, t } = props;
  const params = MOCK_DATA_KIND_PARAMS[generator.kind] || [];
  if (generator.kind === 'reference') {
    const fk = info.profile.foreignKey;
    return (
      <span className="gn-mock-data-param-hint">
        {fk ? t('mock_data.param.reference_hint', { table: fk.table, column: fk.column, count: info.referenceCount }) : null}
      </span>
    );
  }
  if (params.length === 0) return <span className="gn-mock-data-param-hint">{t('mock_data.param.none')}</span>;
  return (
    <fieldset className="gn-mock-data-params" disabled={disabled}>
      {params.map((key) => <React.Fragment key={key}>{renderMockDataParam(key, props)}</React.Fragment>)}
    </fieldset>
  );
};
