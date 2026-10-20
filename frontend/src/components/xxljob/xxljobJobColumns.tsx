import React from 'react';
import { Tag } from 'antd';
import { t } from '../../i18n';
import {
  TRIGGER_STATUS_RUNNING,
  formatXxlJobTime,
  type XxlJobInfo,
} from './xxljobModel';
import { GLUE_MONACO_LANGUAGE } from './xxljobJobEditor';

// 任务面板的列定义。对齐官方后台 jobinfo 列表：任务描述、调度、运行模式、
// 状态、负责人；执行器参数等长文本放 Tooltip。
export const buildJobColumns = (options: {
  nextTimes: Record<number, string[]>;
  actions: (record: XxlJobInfo) => React.ReactNode;
}) => [
  { title: t('xxljob.column.id'), dataIndex: 'id', width: 70 },
  {
    title: t('xxljob.column.job_name'),
    dataIndex: 'name',
    width: 200,
    ellipsis: true,
  },
  {
    title: t('xxljob.column.schedule'),
    width: 200,
    render: (_value: unknown, record: XxlJobInfo) => (
      <span>{record.scheduleType || '—'} {record.scheduleConf || ''}</span>
    ),
  },
  {
    title: t('xxljob.column.glue_type'),
    width: 180,
    render: (_value: unknown, record: XxlJobInfo) => {
      const glue = record.glueType || 'BEAN';
      const label = t(`xxljob.enum.glue.${glue}`);
      return record.executorHandler ? `${label}：${record.executorHandler}` : label;
    },
  },
  {
    title: t('xxljob.column.executor_param'),
    width: 160,
    ellipsis: { showTitle: true },
    render: (_value: unknown, record: XxlJobInfo) => record.executorParam || '—',
  },
  {
    title: t('xxljob.column.route_strategy'),
    width: 150,
    render: (_value: unknown, record: XxlJobInfo) => {
      const value = record.executorRouteStrategy;
      if (!value) return '—';
      return <Tag>{t(`xxljob.enum.route.${value}`)}</Tag>;
    },
  },
  {
    title: t('xxljob.column.block_strategy'),
    width: 140,
    render: (_value: unknown, record: XxlJobInfo) => {
      const value = record.executorBlockStrategy;
      if (!value) return '—';
      return <Tag>{t(`xxljob.enum.block.${value}`)}</Tag>;
    },
  },
  {
    title: t('xxljob.column.trigger_status'),
    width: 100,
    render: (_value: unknown, record: XxlJobInfo) => (
      record.triggerStatus === TRIGGER_STATUS_RUNNING
        ? <Tag color="green">{t('xxljob.value.trigger_running')}</Tag>
        : <Tag>{t('xxljob.value.trigger_stopped')}</Tag>
    ),
  },
  {
    title: t('xxljob.column.author'),
    dataIndex: 'author',
    width: 110,
    ellipsis: true,
    render: (_value: unknown, record: XxlJobInfo) => record.author || '—',
  },
  {
    title: t('xxljob.column.last_time'),
    width: 170,
    render: (_value: unknown, record: XxlJobInfo) => formatXxlJobTime(record.triggerLastTime),
  },
  {
    title: t('xxljob.column.next_time'),
    width: 300,
    render: (_value: unknown, record: XxlJobInfo) => {
      const times = options.nextTimes[record.id];
      if (!times) return formatXxlJobTime(record.triggerNextTime);
      return times.length > 0 ? times.join(' / ') : '—';
    },
  },
  {
    title: t('xxljob.column.actions'),
    width: 170,
    fixed: 'right' as const,
    render: (_value: unknown, record: XxlJobInfo) => options.actions(record),
  },
];

// GLUE 类型 → Monaco 语言（列展示用不到，编辑器用；集中在这里避免循环引用）。
export const glueMonacoLanguage = (glueType?: string) => GLUE_MONACO_LANGUAGE[glueType ?? 'BEAN'] ?? 'java';
