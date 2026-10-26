import { describe, expect, it } from 'vitest';
import { boundedJSON } from './jsonBoundary';
import { UI_LIMITS, validateUINode } from './uiValidation';
import type { UINode } from './types';

const commands = new Set(['hello']);
describe('bounded declarative UI', () => {
  it('accepts only host-owned nodes and declared commands', () => {
    const body = { type: 'column', children: [
      { type: 'text', text: '<script>alert(1)</script>' },
      { type: 'button', title: 'Run', command: 'hello', arguments: { name: 'Ada' } },
      { type: 'table', columns: [{ key: 'name', title: 'Name' }], rows: [{ name: 'Ada' }] },
    ] };
    expect(validateUINode(body, commands)).toEqual(body);
    expect(() => validateUINode({ type: 'button', command: 'host.arbitrary' }, commands)).toThrow();
  });
  it.each([
    { type: 'html', text: '<b>unsafe</b>' }, { type: 'script' }, { type: 'iframe' },
    { type: 'text', dangerouslySetInnerHTML: { __html: 'unsafe' } },
    { type: 'text', style: { position: 'fixed' } }, { type: 'text', onClick: 'eval()' },
    { type: 'constructor' }, { type: 'text', text: {} }, { type: 'row', children: 'bad' },
    { type: 'table', columns: [{ key: 'x', title: 'X' }, { key: 'x', title: 'X' }], rows: [] },
  ])('rejects unexpected node schema %j', (body) => expect(() => validateUINode(body, commands)).toThrow());
  it('bounds node count, nesting, text, rows, columns and total bytes', () => {
    const many = { type: 'column', children: Array.from({ length: UI_LIMITS.nodes }, () => ({ type: 'text' })) };
    expect(() => validateUINode(many, commands)).toThrow();
    let deep: UINode = { type: 'text' };
    for (let i = 0; i <= UI_LIMITS.depth; i++) deep = { type: 'column', children: [deep] };
    expect(() => validateUINode(deep, commands)).toThrow();
    expect(validateUINode({ type: 'text', text: 'x'.repeat(8193) }, commands).text).toHaveLength(8193);
    expect(() => validateUINode({ type: 'text', text: 'x'.repeat(16385) }, commands)).toThrow();
    expect(validateUINode({ type: 'table', columns: Array.from({ length: 32 }, (_, n) => ({ key: 'c' + n, title: 'x' })), rows: Array.from({ length: 500 }, () => ({})) }, commands).type).toBe('table');
    expect(() => validateUINode({ type: 'table', columns: [], rows: Array.from({ length: 501 }, () => ({})) }, commands)).toThrow();
    expect(() => validateUINode({ type: 'table', columns: Array.from({ length: 33 }, (_, n) => ({ key: 'c' + n, title: 'x' })), rows: [] }, commands)).toThrow();
    expect(() => validateUINode({ type: 'column', children: Array.from({ length: 129 }, () => ({ type: 'text' })) }, commands)).toThrow();
    expect(validateUINode({ type: 'column', children: Array.from({ length: 20 }, () => ({ type: 'text', text: '界'.repeat(2000) })) }, commands).children).toHaveLength(20);
    expect(() => validateUINode({ type: 'table', columns: [{ key: 'c', title: 'C' }], rows: [{ c: 'a'.repeat(UI_LIMITS.cellBytes) }] }, commands)).toThrow();
  });
  it('rejects cyclic, non-JSON, prototype and huge data before rendering', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const value of [cyclic, NaN, Infinity, () => true, JSON.parse('{"__proto__":{}}'), new Array(6001).fill(0)]) {
      expect(() => boundedJSON(value)).toThrow();
    }
  });
});
