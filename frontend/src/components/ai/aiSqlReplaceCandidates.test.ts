import { describe, expect, it } from 'vitest';

import {
  collectOriginalSqlCandidatesForAssistant,
  extractOriginalSqlCandidates,
} from './aiSqlReplaceCandidates';

describe('extractOriginalSqlCandidates', () => {
  it('extracts the sql fence from the AI diagnose prompt', () => {
    const content = [
      '我在执行以下 SQL 时遇到了错误：',
      '```sql',
      'SELECT * FROM users WHERE id = ;',
      '```',
      '',
      '数据库报错信息如下：',
      '```text',
      'ERROR: syntax error at or near ";"',
      '```',
    ].join('\n');
    expect(extractOriginalSqlCandidates(content)).toEqual([
      'SELECT * FROM users WHERE id = ;',
    ]);
  });

  it('extracts every sql fence in order and trims them', () => {
    const content = [
      '```sql',
      '  SELECT 1;',
      '```',
      'some text',
      '```sql',
      'UPDATE t SET a = 1;',
      '```',
    ].join('\n');
    expect(extractOriginalSqlCandidates(content)).toEqual([
      'SELECT 1;',
      'UPDATE t SET a = 1;',
    ]);
  });

  it('ignores non-sql fences and empty sql fences', () => {
    const content = [
      '```text',
      'SELECT 1;',
      '```',
      '```sql',
      '',
      '```',
    ].join('\n');
    expect(extractOriginalSqlCandidates(content)).toEqual([]);
  });

  it('returns empty for empty content', () => {
    expect(extractOriginalSqlCandidates('')).toEqual([]);
    expect(extractOriginalSqlCandidates('no fences here')).toEqual([]);
  });
});

describe('collectOriginalSqlCandidatesForAssistant', () => {
  const buildMessages = () => [
    { id: 'u1', role: 'user', content: '```sql\nSELECT broken;\n```' },
    { id: 'a1', role: 'assistant', content: 'fix: ```sql\nSELECT fixed;\n```' },
    { id: 'u2', role: 'user', content: '还是报错' },
    { id: 'a2', role: 'assistant', content: 'another fix' },
  ] as Parameters<typeof collectOriginalSqlCandidatesForAssistant>[0];

  it('walks back over follow-up messages to the nearest user message with sql fences', () => {
    expect(collectOriginalSqlCandidatesForAssistant(buildMessages(), 'a2')).toEqual([
      'SELECT broken;',
    ]);
  });

  it('uses the immediately preceding user message when it has fences', () => {
    const messages = [
      { id: 'u1', role: 'user', content: '```sql\nSELECT older;\n```' },
      { id: 'u2', role: 'user', content: '```sql\nSELECT newer;\n```' },
      { id: 'a1', role: 'assistant', content: 'ok' },
    ] as Parameters<typeof collectOriginalSqlCandidatesForAssistant>[0];
    expect(collectOriginalSqlCandidatesForAssistant(messages, 'a1')).toEqual(['SELECT newer;']);
  });

  it('returns empty when no preceding user message has sql fences', () => {
    const messages = [
      { id: 'u1', role: 'user', content: '帮我看看这个报错' },
      { id: 'a1', role: 'assistant', content: 'ok' },
    ] as Parameters<typeof collectOriginalSqlCandidatesForAssistant>[0];
    expect(collectOriginalSqlCandidatesForAssistant(messages, 'a1')).toEqual([]);
  });

  it('returns empty for unknown assistant message id', () => {
    expect(collectOriginalSqlCandidatesForAssistant(buildMessages(), 'missing')).toEqual([]);
  });
});
