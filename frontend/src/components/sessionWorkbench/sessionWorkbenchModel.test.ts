import { describe, expect, it } from 'vitest';
import {
  availableSessionActions,
  buildSessionActionRequest,
  filterSessions,
  formatSessionDuration,
  isRedisConnection,
  normalizeSessionPayload,
  resolveSessionActionTarget,
  sessionConnections,
  sessionActionDisplayId,
  truncateSessionStatement,
  type DatabaseSession,
  type SessionCapability,
} from './sessionWorkbenchModel';

const translate = (key: string, params?: Record<string, unknown>): string => (
  `${key}:${JSON.stringify(params || {})}`
);

const dualCapability: SessionCapability = {
  supported: true,
  canCancelQuery: true,
  canTerminateSession: true,
  cancelTarget: 'queryId',
  terminateTarget: 'sessionId',
};

const session: DatabaseSession = {
  key: 'mysql:42:query-42',
  databaseOrTenant: 'analytics',
  sessionId: '42',
  queryId: 'query-42',
  statement: 'SELECT * FROM orders',
  state: 'running',
  user: 'analyst',
};

describe('sessionWorkbenchModel', () => {
  it('normalizes the Wails payload without inventing identifiers', () => {
    const payload = normalizeSessionPayload({
      engine: 'postgres',
      capability: {
        supported: true,
        canCancelQuery: true,
        canTerminateSession: true,
        cancelTarget: 'sessionId',
        terminateTarget: 'sessionId',
      },
      sessions: [{
        key: 'postgres:42',
        sessionId: 42,
        queryId: null,
        durationMs: '1500',
        statement: ' SELECT 1 ',
      }],
    });

    expect(payload.sessions[0]).toMatchObject({
      key: 'postgres:42',
      sessionId: '42',
      statement: 'SELECT 1',
      durationMs: 1500,
    });
    expect(payload.sessions[0].queryId).toBeUndefined();
  });

  it('uses the adapter-declared target and never falls back across ID types', () => {
    expect(resolveSessionActionTarget(dualCapability, 'cancelQuery', session)).toBe('query-42');
    expect(resolveSessionActionTarget(dualCapability, 'terminateSession', session)).toBe('42');
    expect(resolveSessionActionTarget(
      { ...dualCapability, cancelTarget: 'queryId' },
      'cancelQuery',
      { ...session, queryId: undefined },
    )).toBe('');
  });

  it('builds both action requests with their original IDs intact', () => {
    expect(buildSessionActionRequest(dualCapability, 'cancelQuery', session)).toEqual({
      action: 'cancelQuery',
      sessionId: '42',
      queryId: 'query-42',
      instanceId: undefined,
      serialNumber: undefined,
    });
    expect(sessionActionDisplayId(dualCapability, 'terminateSession', session)).toBe('42');
  });

  it('hides actions whose required composite Oracle identifiers are incomplete', () => {
    const oracleCapability: SessionCapability = {
      supported: true,
      canCancelQuery: false,
      canTerminateSession: true,
      terminateTarget: 'sessionId',
      terminateRequiresInstanceAndSerial: true,
    };
    expect(availableSessionActions(oracleCapability, {
      ...session,
      queryId: undefined,
      instanceId: '1',
      serialNumber: undefined,
    })).toEqual([]);
    expect(availableSessionActions(oracleCapability, {
      ...session,
      queryId: undefined,
      instanceId: '1',
      serialNumber: '7',
    })).toEqual(['terminateSession']);
    expect(sessionActionDisplayId(oracleCapability, 'terminateSession', {
      ...session,
      instanceId: '1',
      serialNumber: '7',
    })).toBe('42,7,@1');
  });

  it('filters Redis out of the shared session connection selector', () => {
    const mysql = { id: 'mysql', name: 'MySQL', config: { type: 'mysql' } } as any;
    const redis = { id: 'redis', name: 'Redis', config: { type: 'redis' } } as any;
    const customRedis = { id: 'custom', name: 'Redis custom', config: { type: 'custom', driver: 'rediss' } } as any;

    expect(isRedisConnection(redis)).toBe(true);
    expect(isRedisConnection(customRedis)).toBe(true);
    expect(sessionConnections([mysql, redis, customRedis])).toEqual([mysql]);
  });

  it('filters across the normalized list fields and formats summaries', () => {
    const other = {
      ...session,
      key: 'mysql:43',
      sessionId: '43',
      queryId: 'query-43',
      statement: 'SELECT 1',
      user: 'reader',
    };
    expect(filterSessions([session, other], 'ORDERS')).toEqual([session]);
    expect(filterSessions([{ ...session, serialNumber: '99' }], '99')).toHaveLength(1);
    expect(truncateSessionStatement('abcdefgh', 5)).toBe('abcd…');
    expect(formatSessionDuration(1500, translate)).toContain('session_workbench.duration.seconds');
    expect(formatSessionDuration(undefined, translate)).toContain('session_workbench.value.empty');
  });
});
