import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import {
  DATA_SYNC_NEW_DATABASE_OPTION,
  DataSyncDatabaseField,
} from './DataSyncDatabaseField';
import { targetHintKey, taskKindCanCreateTarget } from './mappingTable/dataSyncMappingStatus';
import type { DataSyncDatabaseMetadata } from './model';
import { createDataSyncWorkbenchTranslate } from './text';
import type { DataSyncMetadataResult } from './useDataSyncMetadata';

const t = createDataSyncWorkbenchTranslate('zh-CN');

const databases = (
  names: string[],
  status: DataSyncMetadataResult<DataSyncDatabaseMetadata>['status'] = 'ready',
): DataSyncMetadataResult<DataSyncDatabaseMetadata> => ({
  status,
  items: names.map((name) => ({ name }) as DataSyncDatabaseMetadata),
  error: '',
  reload: () => undefined,
});

const render = (props: Partial<React.ComponentProps<typeof DataSyncDatabaseField>> = {}) => {
  const onChange = vi.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <DataSyncDatabaseField
        value=""
        databases={databases(['information_schema', 'sales'])}
        allowCreate={false}
        t={t}
        onChange={onChange}
        {...props}
      />,
    );
  });
  return { renderer, onChange };
};

const optionValues = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType('option').map((option) => option.props.value);

describe('DataSyncDatabaseField', () => {
  it('only offers existing databases when creation is not allowed', () => {
    const { renderer } = render();
    expect(optionValues(renderer)).not.toContain(DATA_SYNC_NEW_DATABASE_OPTION);
  });

  it('lets a migration target enter a database that does not exist yet', () => {
    const { renderer, onChange } = render({ allowCreate: true });
    expect(optionValues(renderer)).toContain(DATA_SYNC_NEW_DATABASE_OPTION);

    act(() => {
      renderer.root
        .findByProps({ 'data-endpoint-control': 'database' })
        .props.onChange({ target: { value: DATA_SYNC_NEW_DATABASE_OPTION } });
    });
    const input = renderer.root.findByProps({ 'data-endpoint-control': 'new-database' });
    act(() => input.props.onChange({ target: { value: '  my_lease  ' } }));
    act(() => renderer.root.findByProps({ 'data-endpoint-control': 'new-database' }).props.onBlur());

    expect(onChange).toHaveBeenCalledWith('my_lease');
    expect(onChange).not.toHaveBeenCalledWith(DATA_SYNC_NEW_DATABASE_OPTION);
  });

  it('discards an empty new database name', () => {
    const { renderer, onChange } = render({ allowCreate: true });
    act(() => {
      renderer.root
        .findByProps({ 'data-endpoint-control': 'database' })
        .props.onChange({ target: { value: DATA_SYNC_NEW_DATABASE_OPTION } });
    });
    act(() => renderer.root.findByProps({ 'data-endpoint-control': 'new-database' }).props.onBlur());
    expect(onChange).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ 'data-endpoint-control': 'new-database' })).toHaveLength(0);
  });

  it('explains that an unknown migration target database will be created', () => {
    const { renderer } = render({ allowCreate: true, value: 'my_lease' });
    const hint = renderer.root.findByProps({ 'data-database-pending-create': 'true' });
    expect(hint.children.join('')).toContain('my_lease');
  });

  it('does not claim creation while the database list is still loading', () => {
    const { renderer } = render({
      allowCreate: true,
      value: 'my_lease',
      databases: databases([], 'loading'),
    });
    expect(renderer.root.findAllByProps({ 'data-database-pending-create': 'true' })).toHaveLength(0);
  });
});

describe('target table hints by task kind', () => {
  it('data sync and legacy migrations may create target tables', () => {
    expect(taskKindCanCreateTarget('reconcile')).toBe(true);
    expect(taskKindCanCreateTarget('migration')).toBe(true);
    expect(taskKindCanCreateTarget('cdc')).toBe(false);
    expect(taskKindCanCreateTarget('querySink')).toBe(false);
  });

  it('tells data sync how to create a missing table and explains why CDC cannot', () => {
    expect(targetHintKey('missing', 'reconcile')).toBe('mapping.target_hint.missing');
    expect(t(targetHintKey('missing', 'reconcile'))).toContain('自动创建');
    expect(targetHintKey('missing', 'cdc')).toBe(
      'mapping.target_hint.missing_requires_existing',
    );
    expect(targetHintKey('create', 'reconcile')).toBe('mapping.target_hint.create');
  });
});
