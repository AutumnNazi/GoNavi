// Cron 构建器纯函数测试：解析与构建互逆、Quartz day/week 互斥约束。
import { describe, expect, it } from 'vitest';
import { buildCronExpression, parseCronExpression } from './XxlJobCronBuilder';

describe('XxlJobCronBuilder 纯函数', () => {
  it('解析官方常见表达式并保持构建往返一致', () => {
    const cases = [
      '0/30 * * * * ?',
      '0 0 0 * * ?',
      '0 0/5 * * * ?',
      '0 15 10 ? * FRI#3',
      '0 0 12 L * ?',
      '0 0 10 ? * FRIL 2026',
      '0 0 1 15W * ?',
    ];
    for (const expression of cases) {
      const rebuilt = buildCronExpression(parseCronExpression(expression));
      expect(rebuilt).toBe(expression);
    }
  });

  it('day 与 week 同时指定时 week 让位为 ?', () => {
    const fields = parseCronExpression('0 0 0 1 1 ?');
    fields.week = { ...fields.week, mode: 'assign', assign: [1] };
    const built = buildCronExpression(fields);
    // week 指定后 day 必须退为 ?（Quartz 不允许两处同时指定）。
    const parts = built.split(' ');
    expect(parts[5]).toBe('?');
    expect(parts[3]).toBe('1');
  });

  it('day/week 均不指定时 day 回退为 *', () => {
    const fields = parseCronExpression('0 0 0 ? * ?');
    const built = buildCronExpression(fields);
    const parts = built.split(' ');
    expect(parts[3]).toBe('*');
    expect(parts[5]).toBe('?');
  });

  it('指定全部取值等价于 *', () => {
    const fields = parseCronExpression('0 0 0 * * ?');
    fields.minute = { ...fields.minute, mode: 'assign', assign: Array.from({ length: 60 }, (_, i) => i) };
    const built = buildCronExpression(fields);
    expect(built.split(' ')[1]).toBe('*');
  });

  it('周字段指定值渲染为英文缩写', () => {
    const fields = parseCronExpression('0 0 0 ? * ?');
    fields.week = { ...fields.week, mode: 'assign', assign: [1, 3, 5] };
    const built = buildCronExpression(fields);
    expect(built.split(' ')[5]).toBe('SUN,TUE,THU');
  });
});
