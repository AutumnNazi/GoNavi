import React from 'react';
import { readFileSync } from 'node:fs';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentLanguage } from '../../i18n';
import { DataSyncTaskEditor } from './DataSyncEditorRouter';
import { createStaticDataSyncWorkbenchGateway } from './gateway';
import type { DataSyncWorkbenchGateway } from './gateway';
import {
  createDataSyncTableMapping,
  createDataSyncTaskDraft,
  type DataSyncTaskDefinition,
} from './model';
import { createDataSyncWorkbenchTranslate } from './text';

// 备份目录必须能通过本机目录选择器填写，而不是要求用户手敲绝对路径。
// 取消与失败必须区分开：取消要静默保留原值，失败要提示且不能把错值写进任务。

const backupTask = (): DataSyncTaskDefinition => {
  const task = createDataSyncTaskDraft({
    id: 'backup-picker',
    kind: 'backup',
    name: '数据库备份',
  });
  return {
    ...task,
    source: { ...task.source, connectionId: 'source', type: 'sqlite', database: 'sample.db' },
    backup: { directory: '/data/backups', content: 'both' },
    mappings: [createDataSyncTableMapping('orders', 'orders', '')],
    trigger: { mode: 'interval', intervalSeconds: 60, timezone: 'Local' },
  };
};

const withPicker = (
  pick: DataSyncWorkbenchGateway['selectBackupDirectory'],
): DataSyncWorkbenchGateway => ({
  ...createStaticDataSyncWorkbenchGateway(),
  selectBackupDirectory: pick,
});

const renderDelivery = async (gateway: DataSyncWorkbenchGateway) => {
  const patch = vi.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <DataSyncTaskEditor
        task={backupTask()}
        activeStage="delivery"
        gateway={gateway}
        capability={{ level: 'full', canExecute: true, supportsAutoCreate: false, supportsCdc: false }}
        preflight={null}
        preflightStale
        t={createDataSyncWorkbenchTranslate('zh-CN')}
        onPatch={patch}
        onStageChange={vi.fn()}
      />,
    );
  });
  const browse = renderer.root
    .findAllByType('button')
    .find((button) => button.props.children === '浏览…')!;
  return { renderer, patch, browse };
};

describe('backup directory picker', () => {
  beforeEach(() => setCurrentLanguage('zh-CN'));

  it('keeps the path full-width with Browse in the same row', async () => {
    const { renderer } = await renderDelivery(withPicker(async () => null));
    const row = renderer.root.findByProps({ className: 'gn-data-sync-inline-control gn-data-sync-backup-directory-control' });
    expect(row.findAllByType('input')).toHaveLength(1);
    expect(row.findAllByType('button')).toHaveLength(1);
    const css = readFileSync(new URL('./DataSyncBackupEditor.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.gn-data-sync-backup-directory-control\s*\{[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.gn-data-sync-backup-directory-control \.gn-data-sync-button\s*\{[^}]*left:\s*calc\(100% \+ 8px\);/s);
    expect(css).toMatch(/\.gn-data-sync-backup-output\s*\{[^}]*padding-right:\s*140px;/s);
    await act(async () => renderer.unmount());
  });

  it('writes the selected directory into the task', async () => {
    const pick = vi.fn(async () => '/Volumes/Archive/2026');
    const { renderer, patch, browse } = await renderDelivery(withPicker(pick));

    expect(browse).toBeDefined();
    await act(async () => {
      await browse.props.onClick();
    });

    expect(pick).toHaveBeenCalledWith('/data/backups');
    expect(patch).toHaveBeenCalledWith({
      backup: { directory: '/Volumes/Archive/2026', content: 'both' },
    });
    await act(async () => renderer.unmount());
  });

  it('keeps the current directory untouched when the picker is cancelled', async () => {
    const { renderer, patch, browse } = await renderDelivery(withPicker(async () => null));

    await act(async () => {
      await browse.props.onClick();
    });

    expect(patch).not.toHaveBeenCalled();
    const input = renderer.root
      .findAllByType('input')
      .find((node) => node.props.value === '/data/backups');
    expect(input).toBeDefined();
    await act(async () => renderer.unmount());
  });

  it('surfaces a failure instead of silently keeping the old path', async () => {
    const { renderer, patch, browse } = await renderDelivery(
      withPicker(async () => {
        throw new Error('picker unavailable');
      }),
    );

    await act(async () => {
      await browse.props.onClick();
    });

    expect(patch).not.toHaveBeenCalled();
    const alert = renderer.root.findAllByProps({ role: 'alert' });
    expect(alert.length).toBeGreaterThan(0);
    await act(async () => renderer.unmount());
  });
});
