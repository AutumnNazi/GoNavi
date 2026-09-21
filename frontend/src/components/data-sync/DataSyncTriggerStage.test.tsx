import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { DataSyncTaskEditor } from './DataSyncTaskEditor';
import { createStaticDataSyncWorkbenchGateway } from './gateway';
import {
  createDataSyncTableMapping,
  createDataSyncTaskDraft,
  reviseDataSyncTask,
  type DataSyncRouteCapability,
  type DataSyncTaskDefinition,
  type DataSyncTaskStage,
} from './model';
import { createDataSyncWorkbenchTranslate } from './text';

const supportedCapability: DataSyncRouteCapability = {
  level: 'full',
  canExecute: true,
  supportsAutoCreate: true,
  supportsAutoAddColumns: true,
  requiresExistingTarget: false,
  supportsMutations: true,
  supportsCdc: true,
};

const configuredTask = (
  expression: string,
  timezone = 'Asia/Shanghai',
): DataSyncTaskDefinition => {
  const base = createDataSyncTaskDraft({ id: 'cron-task', kind: 'reconcile' });
  return reviseDataSyncTask(base, {
    name: '订单同步',
    source: { ...base.source, connectionId: 'mysql-prod' },
    target: { ...base.target, connectionId: 'pg-warehouse' },
    mappings: [
      {
        ...createDataSyncTableMapping('map-1', 'orders', 'ods.orders'),
        keyColumns: ['id'],
      },
    ],
    trigger: { mode: 'cron', expression, timezone, overlap: 'skip' },
  });
};

const renderTrigger = async (
  task: DataSyncTaskDefinition,
  activeStage: DataSyncTaskStage = 'trigger',
  onStageChange: (stage: DataSyncTaskStage) => void = () => undefined,
) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <DataSyncTaskEditor
        task={task}
        gateway={createStaticDataSyncWorkbenchGateway()}
        capability={supportedCapability}
        activeStage={activeStage}
        preflight={null}
        preflightStale
        t={createDataSyncWorkbenchTranslate('zh-CN')}
        onStageChange={onStageChange}
        onPatch={vi.fn()}
      />,
    );
    await Promise.resolve();
  });
  return renderer;
};

describe('DataSyncTaskEditor trigger stage Cron contract', () => {
  it('documents the five-field Cron format next to the expression input', async () => {
    const renderer = await renderTrigger(configuredTask(''));
    const section = renderer.root.findByProps({ 'data-data-sync-trigger': 'true' });

    const hint = section.findAllByProps({
      className: 'gn-data-sync-field-hint',
    });
    expect(hint).toHaveLength(1);
    // issue #1298：输入框原先没有任何格式说明，用户只能去读后端源码。
    expect(JSON.stringify(hint[0]!.props.children)).toContain('分 时 日 月 周');
    expect(
      section
        .findAllByType('input')
        .some((input) =>
          String(input.props['aria-describedby'] || '').includes(
            'gn-data-sync-cron-format',
          ),
        ),
    ).toBe(true);
  });

  it('marks the trigger step blocked for a six-field expression instead of endpoints', async () => {
    const renderer = await renderTrigger(configuredTask('0 0 3 * * *'));

    // 阻断项必须落在“运行方式”阶段，用户点“打开问题”才会到达 Cron 输入框。
    expect(
      renderer.root.findByProps({ 'data-stage': 'trigger' }).props['data-status'],
    ).toBe('blocked');
    expect(
      renderer.root.findByProps({ 'data-stage': 'endpoints' }).props[
        'data-status'
      ],
    ).not.toBe('blocked');
  });

  it('locates the cron problem on the trigger stage from the preflight checklist', async () => {
    const located: DataSyncTaskStage[] = [];
    const renderer = await renderTrigger(
      configuredTask('0 0 3 * * *'),
      'preflight',
      (stage) => located.push(stage),
    );
    const checklist = renderer.root.findByProps({
      className: 'gn-data-sync-preflight-checklist',
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('分 时 日 月 周');

    await act(async () => {
      checklist
        .findAllByType('button')
        .find((button) => button.props.onClick)!
        .props.onClick();
      await Promise.resolve();
    });
    expect(located).toContain('trigger');
  });

  it('keeps a valid five-field expression free of blockers', async () => {
    const renderer = await renderTrigger(configuredTask('0 3 * * *'));
    expect(
      renderer.root.findByProps({ 'data-stage': 'trigger' }).props['data-status'],
    ).not.toBe('blocked');
  });
});
