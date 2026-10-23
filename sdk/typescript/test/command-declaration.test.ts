import { describe, expect, it } from 'vitest';
import { validateCommand } from '../src/commandDeclaration.js';
describe('command declaration', () => {
  it('accepts write and rejects aliases', () => {
    expect(() => validateCommand({ id: 'run.now_1-A', title: '中'.repeat(85), effect: 'write', inputSchema: { type: 'object' } })).not.toThrow();
    expect(() => validateCommand({ id: 'run', title: 'Run', effect: 'WRITE' })).toThrow(/unsupported command effect/);
    expect(() => validateCommand({ id: '-run', title: 'Run', effect: 'read' })).toThrow(/invalid command declaration/);
    expect(() => validateCommand({ id: 'run', title: '中'.repeat(86), effect: 'read' })).toThrow(/invalid command declaration/);
    expect(() => validateCommand({ id: 'run', title: 'Run', description: '文'.repeat(1366) })).toThrow(/invalid command declaration/);
    expect(() => validateCommand({ id: 'run', title: 'Run', inputSchema: [] })).toThrow(/invalid command schema/);
  });
});
