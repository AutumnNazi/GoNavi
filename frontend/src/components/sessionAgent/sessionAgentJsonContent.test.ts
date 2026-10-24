import { describe, expect, it } from 'vitest';
import { parseJsonMessage } from './sessionAgentJsonContent';

/**
 * 子 Agent 把结构化结论当助手消息发出（审批 / 交付验证 / 市场审查），
 * 浏览端要把它拆成「正文 + 摘要行」，而不是渲染成一坨单行 JSON。
 *
 * 判定规则刻意保守：只处理顶层对象，且要求 ≥2 个字段（单字段时必须是
 * 字符串值），避免把工具的原始输出改头换面。
 */
describe('parseJsonMessage', () => {
  it('extracts the summary as the prose of a market review conclusion', () => {
    const raw = '{"acceptance":[],"findings":[],"summary":"审查被环境能力阻塞：会话仅提供协作等待相关工具。","verdict":"blocked","verification":[]}';
    const view = parseJsonMessage(raw);
    expect(view).not.toBeNull();
    expect(view!.prose).toBe('审查被环境能力阻塞：会话仅提供协作等待相关工具。');
    expect(view!.proseField).toBe('summary');
    // 其余字段收成摘要行：枚举显示原值、数组显示条目数。
    const byKey = new Map(view!.meta.map((row) => [row.key, row]));
    expect(byKey.get('verdict')?.value).toBe('blocked');
    expect(byKey.get('findings')?.count).toBe(0);
    expect(byKey.get('acceptance')?.count).toBe(0);
  });

  it('picks the longest string as the prose of an approval verdict', () => {
    const raw = '{"outcome":"allow","rationale":"用户请求更新项目，且 AGENTS.md 明确授权自动执行仅快进 git pull。","risk_level":"medium","user_authorization":"high"}';
    const view = parseJsonMessage(raw);
    expect(view!.proseField).toBe('rationale');
    expect(view!.prose).toContain('AGENTS.md');
    const byKey = new Map(view!.meta.map((row) => [row.key, row]));
    expect(byKey.get('outcome')?.value).toBe('allow');
    expect(byKey.get('risk_level')?.value).toBe('medium');
    expect(byKey.get('user_authorization')?.value).toBe('high');
  });

  it('treats a single-field enum conclusion as a message with no extra rows', () => {
    const view = parseJsonMessage('{"outcome":"allow"}');
    expect(view).not.toBeNull();
    expect(view!.prose).toBe('allow');
    expect(view!.meta).toHaveLength(0);
  });

  it('keeps the array details available for expansion', () => {
    const raw = '{"summary":"结论。","acceptance":[{"criterion":"x","status":"uncertain"}]}';
    const view = parseJsonMessage(raw);
    const row = view!.meta.find((item) => item.key === 'acceptance');
    expect(row?.count).toBe(1);
    expect(row?.detail).toContain('"criterion"');
  });

  it('leaves ordinary prose untouched', () => {
    expect(parseJsonMessage('这是一段普通正文，不该被当成 JSON。')).toBeNull();
  });

  it('leaves a json fragment embedded in prose untouched', () => {
    expect(parseJsonMessage('结果如下：{"a":1}')).toBeNull();
  });

  it('leaves raw single-field tool output untouched', () => {
    // 工具的原始输出不该被改头换面。
    expect(parseJsonMessage('{"port":8080}')).toBeNull();
    expect(parseJsonMessage('{}')).toBeNull();
    expect(parseJsonMessage('["a","b"]')).toBeNull();
  });

  it('leaves broken json untouched', () => {
    expect(parseJsonMessage('{"summary": ')).toBeNull();
  });

  it('leaves empty input untouched', () => {
    expect(parseJsonMessage('')).toBeNull();
    expect(parseJsonMessage('   ')).toBeNull();
    expect(parseJsonMessage(null)).toBeNull();
  });
});
