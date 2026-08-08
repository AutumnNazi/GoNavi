import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataSyncPreflightPanel } from './DataSyncPreflightPanel';
import {
  createDataSyncWorkbenchTranslate,
  dataSyncValidationIssueText,
} from './text';

afterEach(() => {
  vi.useRealTimers();
});

describe('DataSyncPreflightPanel production approval', () => {
  it('localizes known backend issue codes and preserves unknown diagnostics', () => {
    const t = createDataSyncWorkbenchTranslate('zh-CN');

    expect(
      dataSyncValidationIssueText(
        {
          code: 'route_unsupported',
          message: 'migration route mysql -> qdrant is unsupported',
        },
        t,
      ),
    ).toBe('当前源端与目标端组合不支持执行此同步任务。');
    expect(
      dataSyncValidationIssueText(
        { code: 'driver_specific_failure', message: 'driver unavailable' },
        t,
      ),
    ).toBe('driver unavailable');
  });

  it('prefers the localized validation text over a backend English message', () => {
    const renderer = TestRenderer.create(
      <DataSyncPreflightPanel
        snapshot={{
          taskId: 'task-1',
          taskRevision: 5,
          status: 'blocked',
          issues: [
            {
              id: 'definition_invalid:map-1',
              code: 'definition_invalid',
              severity: 'blocker',
              stage: 'mappings',
              mappingId: 'map-1',
              message:
                'table mapping 1 requires a targetTable and a sourceTable unless this is a query sink',
            },
          ],
          definitionHash: '',
          approvalRequired: false,
          approvalSatisfied: false,
          checkedAt: '2030-08-08T00:00:00.000Z',
        }}
        currentRevision={5}
        stale={false}
        running={false}
        t={createDataSyncWorkbenchTranslate('zh-CN')}
        onLocateIssue={() => undefined}
      />,
    );

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain(
      '任务定义无效，请检查必填项、对象映射和执行策略。',
    );
    expect(renderer.root.findByType('p').props.title).toContain(
      'requires a targetTable',
    );
  });

  it('uses the backend notBefore window and never creates a frontend-only approval', () => {
    vi.useFakeTimers();
    const now = Date.parse('2030-08-08T00:00:00.000Z');
    vi.setSystemTime(now);
    const onBegin = vi.fn();
    const onApprove = vi.fn();
    const snapshot = {
      taskId: 'task-1',
      taskRevision: 4,
      status: 'passed' as const,
      issues: [],
      definitionHash: 'hash-1',
      approvalRequired: true,
      approvalSatisfied: false,
      checkedAt: new Date(now).toISOString(),
    };
    const t = createDataSyncWorkbenchTranslate('en-US');
    const renderer = TestRenderer.create(
      <DataSyncPreflightPanel
        snapshot={snapshot}
        currentRevision={4}
        stale={false}
        running={false}
        t={t}
        onLocateIssue={() => undefined}
        onBeginApproval={onBegin}
        onApprove={onApprove}
      />,
    );

    act(() => {
      renderer.root
        .findAllByType('button')
        .find((button) =>
          button.children.includes('Begin server 10-second confirmation'),
        )!
        .props.onClick();
    });
    expect(onBegin).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();

    act(() => {
      renderer.update(
        <DataSyncPreflightPanel
          snapshot={snapshot}
          currentRevision={4}
          stale={false}
          running={false}
          t={t}
          onLocateIssue={() => undefined}
          approvalChallenge={{
            definitionHash: 'hash-1',
            notBefore: new Date(now + 10_000).toISOString(),
            expiresAt: new Date(now + 120_000).toISOString(),
          }}
          onBeginApproval={onBegin}
          onApprove={onApprove}
        />,
      );
    });
    expect(
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes('Wait 10 seconds'))!.props.disabled,
    ).toBe(true);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    const confirm = renderer.root
      .findAllByType('button')
      .find((button) =>
        button.children.includes('Confirm production write and grant token'),
      )!;
    expect(confirm.props.disabled).toBe(false);
    act(() => confirm.props.onClick());
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
