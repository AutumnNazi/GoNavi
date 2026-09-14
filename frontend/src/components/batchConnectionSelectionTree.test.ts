import { describe, expect, it } from 'vitest';

import type { ConnectionTag, SavedConnection } from '../types';
import { setCurrentLanguage } from '../i18n';
import {
  UNGROUPED_GROUP_ID,
  buildBatchConnectionSelectionTree,
  collectConnectionIdsFromCheckedKeys,
  collectConnectionIdsFromTree,
  collectFullySelectedGroupNames,
  collectGroupKeys,
  deriveCheckedKeys,
  filterBatchConnectionSelectionTree,
  groupSelectionKey,
} from './batchConnectionSelectionTree';

const connections = [
  { id: 'conn-1', name: 'Local', config: { type: 'mysql', host: 'localhost', port: 3306 } },
  { id: 'conn-2', name: 'Prod', config: { type: 'postgres', host: 'db.example.com', port: 5432 } },
  { id: 'conn-3', name: 'Cache', config: { type: 'redis', host: '127.0.0.1', port: 6379 } },
  { id: 'conn-4', name: 'Dev-240', config: { type: 'mysql', host: '10.0.0.240', port: 3306 } },
] as SavedConnection[];

describe('batchConnectionSelectionTree', () => {
  it('wraps ungrouped hosts into a single selectable bucket', () => {
    setCurrentLanguage('zh-CN');
    const tree = buildBatchConnectionSelectionTree({ connections });

    expect(tree).toHaveLength(1);
    expect(tree[0].groupId).toBe(UNGROUPED_GROUP_ID);
    expect(tree[0].connectionCount).toBe(4);
    expect(collectConnectionIdsFromTree(tree)).toEqual(['conn-1', 'conn-2', 'conn-3', 'conn-4']);
  });

  it('nests connections under groups and keeps leftover hosts ungrouped', () => {
    setCurrentLanguage('zh-CN');
    const tags = [
      { id: 'dev', name: '开发', connectionIds: ['conn-1', 'conn-4'] },
      { id: 'prod', name: '生产', connectionIds: ['conn-2'] },
    ] as ConnectionTag[];
    const tree = buildBatchConnectionSelectionTree({ connections, connectionTags: tags });

    expect(tree.map((node) => node.groupId)).toEqual(['dev', 'prod', UNGROUPED_GROUP_ID]);
    expect(collectConnectionIdsFromTree([tree[0]])).toEqual(['conn-1', 'conn-4']);
    expect(collectConnectionIdsFromTree([tree[1]])).toEqual(['conn-2']);
    expect(collectConnectionIdsFromTree([tree[2]])).toEqual(['conn-3']);
  });

  it('includes nested subgroup connections when walking a parent group', () => {
    setCurrentLanguage('zh-CN');
    const tags = [
      { id: 'dev', name: '开发', connectionIds: ['conn-1'], childOrder: ['connection:conn-1', 'tag:oracle'] },
      { id: 'oracle', name: 'Oracle', parentTagId: 'dev', connectionIds: ['conn-4'] },
    ] as ConnectionTag[];
    const tree = buildBatchConnectionSelectionTree({ connections, connectionTags: tags });
    const dev = tree.find((node) => node.groupId === 'dev');

    expect(collectConnectionIdsFromTree(dev ? [dev] : [])).toEqual(['conn-1', 'conn-4']);
  });

  it('treats checking a group key as selecting every descendant connection', () => {
    setCurrentLanguage('zh-CN');
    const tags = [
      { id: 'dev', name: '开发', connectionIds: ['conn-1', 'conn-4'] },
    ] as ConnectionTag[];
    const tree = buildBatchConnectionSelectionTree({ connections, connectionTags: tags });
    const ids = collectConnectionIdsFromCheckedKeys(
      [groupSelectionKey('dev'), 'connection:conn-1', 'connection:conn-4'],
      connections,
    );

    expect(ids).toEqual(['conn-1', 'conn-4']);
    expect(deriveCheckedKeys(tree, ids)).toEqual(expect.arrayContaining([
      groupSelectionKey('dev'),
      'connection:conn-1',
      'connection:conn-4',
    ]));
    expect(collectFullySelectedGroupNames(tree, ids)).toEqual(['开发']);
    expect(collectFullySelectedGroupNames(tree, ['conn-1'])).toEqual([]);
  });

  it('lists only the outermost fully selected groups', () => {
    setCurrentLanguage('zh-CN');
    const tags = [
      { id: 'dev', name: '开发', connectionIds: ['conn-1'], childOrder: ['connection:conn-1', 'tag:oracle'] },
      { id: 'oracle', name: 'Oracle', parentTagId: 'dev', connectionIds: ['conn-4'] },
    ] as ConnectionTag[];
    const tree = buildBatchConnectionSelectionTree({ connections, connectionTags: tags });

    expect(collectFullySelectedGroupNames(tree, ['conn-4'])).toEqual(['Oracle']);
    expect(collectFullySelectedGroupNames(tree, ['conn-1', 'conn-4'])).toEqual(['开发']);
  });

  it('filters groups and connections while keeping ancestor groups visible', () => {
    setCurrentLanguage('zh-CN');
    const tags = [
      { id: 'dev', name: '开发', connectionIds: ['conn-1', 'conn-4'] },
    ] as ConnectionTag[];
    const tree = buildBatchConnectionSelectionTree({ connections, connectionTags: tags });
    const filtered = filterBatchConnectionSelectionTree(tree, '240');

    expect(collectConnectionIdsFromTree(filtered)).toEqual(['conn-4']);
    expect(filtered[0].groupId).toBe('dev');
    expect(collectGroupKeys(filtered)).toEqual([groupSelectionKey('dev')]);
  });
});
