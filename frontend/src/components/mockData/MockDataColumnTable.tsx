import React, { useMemo } from 'react';
import { InputNumber, Select, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { MockDataGeneratorParams } from './MockDataGeneratorParams';
import {
  isMockDataColumnSkippable,
  type MockDataColumnInfo,
  type MockDataColumnPlan,
  type MockDataGenerator,
  type MockDataKind,
} from './mockDataModel';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export type MockDataColumnTableProps = {
  columns: MockDataColumnPlan[];
  infoByName: Map<string, MockDataColumnInfo>;
  disabled: boolean;
  t: Translate;
  onToggle: (name: string, enabled: boolean) => void;
  onKindChange: (name: string, kind: MockDataKind) => void;
  onGeneratorChange: (name: string, patch: Partial<MockDataGenerator>) => void;
  onNullRatioChange: (name: string, ratio: number) => void;
};

const renderBadges = (info: MockDataColumnInfo, t: Translate): React.ReactNode[] => {
  const { profile } = info;
  const badges: React.ReactNode[] = [];
  if (profile.primaryKey) badges.push(<Tag key="pk" color="gold">{t('mock_data.column.badge.pk')}</Tag>);
  else if (profile.unique) badges.push(<Tag key="uq" color="blue">{t('mock_data.column.badge.unique')}</Tag>);
  if (profile.foreignKey) {
    badges.push(
      <Tooltip key="fk" title={`${profile.foreignKey.table}.${profile.foreignKey.column}`}>
        <Tag color="purple">{t('mock_data.column.badge.fk')}</Tag>
      </Tooltip>,
    );
  }
  if (profile.autoIncrement) badges.push(<Tag key="auto">{t('mock_data.column.badge.auto')}</Tag>);
  if (profile.computed) badges.push(<Tag key="computed">{t('mock_data.column.badge.computed')}</Tag>);
  if (info.required) badges.push(<Tag key="required" color="red">{t('mock_data.column.badge.required')}</Tag>);
  if (profile.category === 'unsupported' || profile.category === 'binary') {
    badges.push(<Tag key="unsupported" color="orange">{t('mock_data.column.badge.unsupported')}</Tag>);
  }
  return badges;
};

/** 每列一行：是否生成、生成规则、留空比例、规则参数。 */
export const MockDataColumnTable: React.FC<MockDataColumnTableProps> = ({
  columns, infoByName, disabled, t, onToggle, onKindChange, onGeneratorChange, onNullRatioChange,
}) => {
  const tableColumns = useMemo<ColumnsType<MockDataColumnPlan>>(() => [
    {
      title: t('mock_data.column.header.column'),
      key: 'column',
      width: 260,
      render: (_, plan) => {
        const info = infoByName.get(plan.name);
        return (
          <div className="gn-mock-data-column-cell">
            <Typography.Text strong ellipsis={{ tooltip: plan.name }}>{plan.name}</Typography.Text>
            <Typography.Text type="secondary" className="gn-mock-data-column-type">{info?.profile.type}</Typography.Text>
            <div className="gn-mock-data-column-badges">{info ? renderBadges(info, t) : null}</div>
          </div>
        );
      },
    },
    {
      title: t('mock_data.column.header.enabled'),
      key: 'enabled',
      width: 72,
      align: 'center',
      render: (_, plan) => {
        const info = infoByName.get(plan.name);
        const skippable = info ? isMockDataColumnSkippable(info) : true;
        const forced = info?.profile.computed === true;
        return (
          <Switch size="small" checked={!plan.skip} disabled={disabled || forced || (!skippable && !plan.skip)}
            onChange={(enabled) => onToggle(plan.name, enabled)} />
        );
      },
    },
    {
      title: t('mock_data.column.header.kind'),
      key: 'kind',
      width: 170,
      render: (_, plan) => {
        const info = infoByName.get(plan.name);
        return (
          <Select size="small" style={{ width: '100%' }} value={plan.generator.kind} disabled={disabled || plan.skip}
            options={(info?.allowedKinds || [plan.generator.kind]).map((kind) => ({ value: kind, label: t(`mock_data.kind.${kind}`) }))}
            onChange={(kind: MockDataKind) => onKindChange(plan.name, kind)} />
        );
      },
    },
    {
      title: (
        <Tooltip title={t('mock_data.column.null_ratio_hint')}>
          <span className="gn-mock-data-header-help">
            {t('mock_data.column.header.null_ratio')} <QuestionCircleOutlined />
          </span>
        </Tooltip>
      ),
      key: 'nullRatio',
      width: 120,
      render: (_, plan) => {
        const info = infoByName.get(plan.name);
        if (!info || plan.skip) return <span className="gn-mock-data-param-hint">-</span>;
        if (!info.profile.nullable) return <span className="gn-mock-data-param-hint">{t('mock_data.column.null_not_allowed')}</span>;
        if (info.profile.unique) return <span className="gn-mock-data-param-hint">{t('mock_data.column.null_unique')}</span>;
        if (plan.generator.kind === 'null') return <span className="gn-mock-data-param-hint">100%</span>;
        return (
          <span className="gn-mock-data-param-field">
            <InputNumber size="small" min={0} max={100} step={10} disabled={disabled}
              value={Math.round((plan.nullRatio || 0) * 100)}
              onChange={(value) => onNullRatioChange(plan.name, Math.min(Math.max(Number(value ?? 0), 0), 100) / 100)}
              style={{ width: 64 }} />
            <span className="gn-mock-data-param-label">%</span>
          </span>
        );
      },
    },
    {
      title: t('mock_data.column.header.params'),
      key: 'params',
      render: (_, plan) => {
        const info = infoByName.get(plan.name);
        if (!info || plan.skip) return <span className="gn-mock-data-param-hint">{plan.skip ? t('mock_data.column.skipped') : '-'}</span>;
        return (
          <MockDataGeneratorParams info={info} generator={plan.generator} disabled={disabled} t={t}
            onChange={(patch) => onGeneratorChange(plan.name, patch)} />
        );
      },
    },
  ], [disabled, infoByName, onGeneratorChange, onKindChange, onNullRatioChange, onToggle, t]);

  return (
    <Table<MockDataColumnPlan>
      className="gn-mock-data-column-table"
      size="small"
      rowKey="name"
      pagination={false}
      columns={tableColumns}
      dataSource={columns}
      scroll={{ x: 960 }}
    />
  );
};
