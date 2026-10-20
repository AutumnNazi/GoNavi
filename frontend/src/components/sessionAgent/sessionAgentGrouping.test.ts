import { describe, expect, it } from 'vitest';
import { buildSessionGroups, sessionGroupKey, sortSessionItems } from './SessionAgentListPage';

// 「按项目分组」必须真的看得出是分组：同一项目的会话相邻，且组内只有
// 首行带项目名。

const item = (overrides: Record<string, unknown>) => ({
  providerId: 'codex',
  sessionId: 's',
  title: 't',
  summary: '',
  firstMessage: '',
  projectDir: '',
  createdAt: 0,
  lastActiveAt: 0,
  sourcePath: '/x.jsonl',
  resumeCommand: 'codex resume s',
  ...overrides,
});

describe('sortSessionItems', () => {
  it('groups sessions of the same project together', () => {
    const items = [
      item({ sessionId: 'a1', projectDir: 'E:/beta', lastActiveAt: 300 }),
      item({ sessionId: 'a2', projectDir: 'E:/alpha', lastActiveAt: 200 }),
      item({ sessionId: 'a3', projectDir: 'E:/beta', lastActiveAt: 100 }),
    ];
    const sorted = sortSessionItems(items, 'project');
    expect(sorted.map((i) => i.sessionId)).toEqual(['a2', 'a1', 'a3']);
  });

  it('sorts by last activity when grouping by time', () => {
    const items = [
      item({ sessionId: 'a1', lastActiveAt: 100 }),
      item({ sessionId: 'a2', lastActiveAt: 300 }),
      item({ sessionId: 'a3', lastActiveAt: 200 }),
    ];
    expect(sortSessionItems(items, 'time').map((i) => i.sessionId)).toEqual(['a2', 'a3', 'a1']);
  });
});

describe('sessionGroupKey', () => {
  it('uses the project name in project mode', () => {
    expect(sessionGroupKey(item({ projectDir: 'E:/work/demo' }), 'project')).toBe('demo');
  });

  it('buckets by day in time mode', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    expect(sessionGroupKey(item({ lastActiveAt: today + 1000 }), 'time')).toBe('today');
    expect(sessionGroupKey(item({ lastActiveAt: today - 86400000 + 1000 }), 'time')).toBe('yesterday');
    expect(sessionGroupKey(item({ lastActiveAt: today - 30 * 86400000 }), 'time')).toBe('older');
  });
});

describe('buildSessionGroups', () => {
  it('gives every project its own group with the project name as the group label', () => {
    const groups = buildSessionGroups([
      item({ sessionId: 'a1', projectDir: 'E:/work/alpha', lastActiveAt: 300 }),
      item({ sessionId: 'b1', projectDir: 'E:/work/beta', lastActiveAt: 200 }),
      item({ sessionId: 'a2', projectDir: 'E:/work/alpha', lastActiveAt: 100 }),
    ], 'project');
    expect(groups.map((group) => group.label)).toEqual(['alpha', 'beta']);
    expect(groups.map((group) => group.key)).toEqual(['alpha', 'beta']);
    // 同一项目的会话必须落在同一组里（卡片排在组头下面）。
    expect(groups[0].items.map((i) => i.sessionId)).toEqual(['a1', 'a2']);
    expect(groups[1].items.map((i) => i.sessionId)).toEqual(['b1']);
  });

  it('falls back to the time bucket labels when grouping by time', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const groups = buildSessionGroups([
      item({ sessionId: 't1', lastActiveAt: today + 1000 }),
      item({ sessionId: 'o1', lastActiveAt: today - 30 * 86400000 }),
    ], 'time');
    expect(groups.map((group) => group.key)).toEqual(['today', 'older']);
    expect(groups.map((group) => group.items.length)).toEqual([1, 1]);
  });
});
