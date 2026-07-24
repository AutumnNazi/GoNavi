import { describe, expect, it } from 'vitest';

import {
  buildSavedQueryGroupParentOptions,
  getSavedQueryGroupOwnerIds,
  normalizeSavedQueryGroups,
} from './savedQueryGroups';

describe('saved query groups', () => {
  it('keeps the first group as the owner when a query appears in multiple groups', () => {
    const groups = normalizeSavedQueryGroups([
      { id: 'first', name: 'First', queryIds: ['query-1'] },
      { id: 'second', name: 'Second', queryIds: ['query-1', 'query-2'] },
    ]);

    expect(groups.find((group) => group.id === 'first')?.queryIds).toEqual(['query-1']);
    expect(groups.find((group) => group.id === 'second')?.queryIds).toEqual(['query-2']);
    expect(getSavedQueryGroupOwnerIds(groups)).toEqual(new Map([
      ['query-1', 'first'],
      ['query-2', 'second'],
    ]));
  });

  it('removes invalid parent references and breaks parent cycles', () => {
    const groups = normalizeSavedQueryGroups([
      { id: 'cycle-a', name: 'Cycle A', parentGroupId: 'cycle-b', queryIds: [] },
      { id: 'cycle-b', name: 'Cycle B', parentGroupId: 'cycle-a', queryIds: [] },
      { id: 'missing-parent', name: 'Missing parent', parentGroupId: 'not-found', queryIds: [] },
    ]);
    const groupById = new Map(groups.map((group) => [group.id, group]));

    expect(groupById.get('missing-parent')?.parentGroupId).toBeUndefined();
    groups.forEach((group) => {
      const seen = new Set<string>();
      let parentGroupId = group.parentGroupId;
      while (parentGroupId) {
        expect(seen.has(parentGroupId)).toBe(false);
        seen.add(parentGroupId);
        parentGroupId = groupById.get(parentGroupId)?.parentGroupId;
      }
    });
  });

  it('excludes the edited group and all descendants from parent choices', () => {
    const groups = normalizeSavedQueryGroups([
      { id: 'root', name: 'Root', queryIds: [] },
      { id: 'child', name: 'Child', parentGroupId: 'root', queryIds: [] },
      { id: 'grandchild', name: 'Grandchild', parentGroupId: 'child', queryIds: [] },
      { id: 'other', name: 'Other', queryIds: [] },
    ]);

    expect(buildSavedQueryGroupParentOptions(groups, 'root')).toEqual([
      { value: 'other', label: 'Other' },
    ]);
  });
});
