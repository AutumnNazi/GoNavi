import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ConnectionTag } from '../../types';
import { I18nProvider } from '../../i18n/provider';
import ConnectionImportSettingsPanel, {
  buildConnectionImportGroupOptions,
  resolveConnectionImportPlacement,
  type ConnectionImportNotice,
} from './ConnectionImportSettingsPanel';

const renderImportPanel = (notice?: ConnectionImportNotice | null) => renderToStaticMarkup(
  <I18nProvider preference="zh-CN" onPreferenceChange={() => undefined}>
    <ConnectionImportSettingsPanel
      groupOptions={[]}
      targetGroupId=""
      password=""
      protectedPackageReady={false}
      busy={false}
      notice={notice}
      onTargetGroupChange={() => undefined}
      onChooseFile={() => undefined}
      onPasswordChange={() => undefined}
      onConfirmProtectedPackage={() => undefined}
      onDiscardProtectedPackage={() => undefined}
    />
  </I18nProvider>,
);

describe('ConnectionImportSettingsPanel', () => {
  it('uses the actual import notice severity instead of always showing success', () => {
    const warningMarkup = renderImportPanel({ type: 'warning', message: 'partial import' });
    expect(warningMarkup).toContain('partial import');
    expect(warningMarkup).toContain('ant-alert-warning');
    expect(warningMarkup).not.toContain('ant-alert-success');

    const successMarkup = renderImportPanel({ type: 'success', message: 'import finished' });
    expect(successMarkup).toContain('import finished');
    expect(successMarkup).toContain('ant-alert-success');
    expect(successMarkup).not.toContain('ant-alert-warning');
  });

  it('uses full paths to distinguish nested groups with duplicate names', () => {
    const tags: ConnectionTag[] = [
      { id: 'production', name: '生产', connectionIds: [] },
      { id: 'development', name: '开发', connectionIds: [] },
      { id: 'production-orders', name: '订单', parentTagId: 'production', connectionIds: [] },
      { id: 'development-orders', name: '订单', parentTagId: 'development', connectionIds: [] },
    ];
    expect(buildConnectionImportGroupOptions(tags)).toEqual([
      { value: 'production', label: '生产' },
      { value: 'development', label: '开发' },
      { value: 'production-orders', label: '生产 / 订单' },
      { value: 'development-orders', label: '开发 / 订单' },
    ]);
  });

  it('does not recurse forever when malformed group data contains a cycle', () => {
    const options = buildConnectionImportGroupOptions([
      { id: 'a', name: 'A', parentTagId: 'b', connectionIds: [] },
      { id: 'b', name: 'B', parentTagId: 'a', connectionIds: [] },
    ]);
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.value)).toEqual(['a', 'b']);
  });

  it('preserves existing placement and appends only new or relocated connections', () => {
    const tags: ConnectionTag[] = [
      { id: 'source', name: 'Source', connectionIds: ['existing'] },
      { id: 'target', name: 'Target', connectionIds: ['already-there'] },
    ];
    expect(resolveConnectionImportPlacement(['existing'], '', tags)).toEqual({
      groupAssignment: null,
      manualOrderTargetGroupIds: ['source'],
    });
    expect(resolveConnectionImportPlacement(['existing', 'new'], '', tags)).toEqual({
      groupAssignment: null,
      manualOrderTargetGroupIds: ['source', null],
    });
    expect(resolveConnectionImportPlacement(
      ['already-there'],
      'target',
      tags,
    )).toEqual({
      groupAssignment: null,
      manualOrderTargetGroupIds: ['target'],
    });
    expect(resolveConnectionImportPlacement(
      ['already-there', 'move-me', 'new'],
      'target',
      tags,
    )).toEqual({
      groupAssignment: {
        connectionIds: ['move-me', 'new'],
        targetGroupId: 'target',
      },
      manualOrderTargetGroupIds: ['target'],
    });
  });
});
