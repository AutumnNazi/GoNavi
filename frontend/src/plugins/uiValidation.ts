import { boundedJSON, isRecord } from './jsonBoundary';
import type { UINode } from './types';

export const UI_LIMITS = { depth: 16, nodes: 512, rows: 500, columns: 32, children: 128, bytes: 8 * 1024 * 1024, cellBytes: 256 * 1024 } as const;
const common = ['type', 'text', 'title'];
const allowed: Record<UINode['type'], string[]> = {
  text: common, alert: common, column: [...common, 'children'], row: [...common, 'children'],
  button: [...common, 'command', 'arguments'], table: [...common, 'columns', 'rows'],
};
const invalid = (): never => { throw new Error('plugin.ui.invalid_schema'); };
export function validateUINode(value: unknown, commands: ReadonlySet<string>): UINode {
  boundedJSON(value, UI_LIMITS.bytes, UI_LIMITS.cellBytes);
  let count = 0;
  const visit = (node: unknown, depth: number): void => {
    if (++count > UI_LIMITS.nodes || depth > UI_LIMITS.depth || !isRecord(node)) return invalid();
    if (typeof node.type !== 'string' || !Object.prototype.hasOwnProperty.call(allowed, node.type)) return invalid();
    const type = node.type as UINode['type'];
    if (Object.keys(node).some((key) => !allowed[type].includes(key))) return invalid();
    if ([node.text, node.title].some((text) => text != null && typeof text !== 'string')) return invalid();
    if (typeof node.text === 'string' && new TextEncoder().encode(node.text).length > 16384) return invalid();
    if (typeof node.title === 'string' && new TextEncoder().encode(node.title).length > 1024) return invalid();
    if (type === 'column' || type === 'row') {
      const children = node.children ?? [];
      if (!Array.isArray(children) || children.length > UI_LIMITS.children) return invalid();
      children.forEach((child) => visit(child, depth + 1));
    }
    if (type === 'button' && (typeof node.command !== 'string' || !commands.has(node.command))) return invalid();
    if (node.arguments != null && new TextEncoder().encode(JSON.stringify(node.arguments)).length > 64 * 1024) return invalid();
    if (type === 'table') {
      const columns = node.columns ?? [];
      const rows = node.rows ?? [];
      if (!Array.isArray(columns) || columns.length > UI_LIMITS.columns
        || !Array.isArray(rows) || rows.length > UI_LIMITS.rows) return invalid();
      const keys = new Set<string>();
      for (const col of columns) {
        if (!isRecord(col) || typeof col.key !== 'string' || typeof col.title !== 'string' || keys.has(col.key)
          || col.key.trim() === '' || new TextEncoder().encode(col.key).length > 128 || col.key.includes('\u0000')
          || col.title.trim() === '' || new TextEncoder().encode(col.title).length > 256 || col.title.includes('\u0000')) return invalid();
        keys.add(col.key);
      }
      let dataBytes = 0;
      for (const row of rows) {
        if (!isRecord(row) || Object.keys(row).length > UI_LIMITS.columns) return invalid();
        for (const [key, cell] of Object.entries(row)) {
          dataBytes += new TextEncoder().encode(key + JSON.stringify(cell)).length;
        }
      }
      if (dataBytes > UI_LIMITS.cellBytes) return invalid();
    }
  };
  visit(value, 0);
  return value as UINode;
}
