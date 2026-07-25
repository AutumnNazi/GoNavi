import { describe, expect, it } from 'vitest';

import type { ConnectionTag, SavedConnection } from '../types';
import {
  getConnectionEnvironmentMeta,
  normalizeConnectionEnvironmentType,
  resolveConnectionEnvironmentPresentation,
  resolveConnectionEnvironmentType,
} from './connectionEnvironment';

const connection: SavedConnection = {
  id: 'conn-1',
  name: 'Orders',
  environmentType: 'development',
  config: {
    id: 'conn-1',
    type: 'mysql',
    host: 'db.local',
    port: 3306,
    user: 'root',
  },
};

describe('connectionEnvironment', () => {
  it('falls back to local for missing and unsupported persisted values', () => {
    expect(normalizeConnectionEnvironmentType(undefined)).toBe('local');
    expect(normalizeConnectionEnvironmentType('unknown')).toBe('local');
    expect(getConnectionEnvironmentMeta(undefined).color).toBe('#8c8c8c');
  });

  it('uses the ungrouped connection environment', () => {
    expect(resolveConnectionEnvironmentType(connection, [])).toBe('development');
  });

  it('lets the direct group environment override the connection environment', () => {
    const tags: ConnectionTag[] = [
      {
        id: 'production-group',
        name: 'Production',
        environmentType: 'production',
        connectionIds: ['conn-1'],
      },
    ];

    expect(resolveConnectionEnvironmentType(connection, tags)).toBe('production');
    expect(resolveConnectionEnvironmentPresentation(
      connection,
      tags,
      (key) => key,
    )).toEqual({
      type: 'production',
      color: '#e5484d',
      label: 'connection.environment.production',
    });
  });

  it('treats a legacy direct group without metadata as local', () => {
    const tags: ConnectionTag[] = [
      {
        id: 'legacy-group',
        name: 'Legacy',
        connectionIds: ['conn-1'],
      },
    ];

    expect(resolveConnectionEnvironmentType(connection, tags)).toBe('local');
  });

  it('does not inherit a parent group environment over the direct group', () => {
    const tags: ConnectionTag[] = [
      {
        id: 'parent',
        name: 'Production',
        environmentType: 'production',
        connectionIds: [],
      },
      {
        id: 'child',
        name: 'Local child',
        parentTagId: 'parent',
        environmentType: 'local',
        connectionIds: ['conn-1'],
      },
    ];

    expect(resolveConnectionEnvironmentType(connection, tags)).toBe('local');
  });
});
