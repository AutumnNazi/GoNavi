import { describe, expect, it } from 'vitest';
import { validateUINode } from './uiValidation';
describe('panel text bounds', () => {
  it('allows host-sized text and rejects one byte over the text or title limit', () => {
    expect(validateUINode({ type: 'text', text: 'a'.repeat(8193) }, new Set())).toMatchObject({ text: 'a'.repeat(8193) });
    expect(() => validateUINode({ type: 'text', text: 'a'.repeat(16385) }, new Set())).toThrow();
    expect(() => validateUINode({ type: 'text', title: 'a'.repeat(1025) }, new Set())).toThrow(/invalid_schema/);
    const commands = new Set(['run']);
    expect(validateUINode({ type: 'table', columns: [{ key: '中'.repeat(42), title: '中'.repeat(85) }], rows: [] }, commands).type).toBe('table');
    expect(() => validateUINode({ type: 'table', columns: [{ key: '中'.repeat(43), title: 'C' }], rows: [] }, commands)).toThrow();
    expect(() => validateUINode({ type: 'table', columns: [{ key: 'c', title: '中'.repeat(86) }], rows: [] }, commands)).toThrow();
    expect(validateUINode({ type: 'button', command: 'run', arguments: { k: 'a'.repeat(64 * 1024 - 8) } }, commands).type).toBe('button');
    expect(() => validateUINode({ type: 'button', command: 'run', arguments: { k: 'a'.repeat(64 * 1024 - 7) } }, commands)).toThrow();
  });
});
