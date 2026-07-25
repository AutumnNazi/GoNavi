import { describe, expect, it } from 'vitest';

import {
  buildSavedConnectionInput,
  createEmptyConnectionSecretClearState,
} from './connectionModalConfig';

const config = {
  id: 'conn-1',
  type: 'mysql',
  host: 'db.local',
  port: 3306,
  user: 'root',
};

describe('connection modal environment persistence', () => {
  it('stores the selected environment type with the saved connection', () => {
    const result = buildSavedConnectionInput({
      config,
      values: {
        type: 'mysql',
        name: 'Production',
        environmentType: 'production',
      },
      clearSecrets: createEmptyConnectionSecretClearState(),
    });

    expect(result.environmentType).toBe('production');
  });

  it('defaults missing environment values to local', () => {
    const result = buildSavedConnectionInput({
      config,
      values: {
        type: 'mysql',
        name: 'Legacy',
      },
      clearSecrets: createEmptyConnectionSecretClearState(),
    });

    expect(result.environmentType).toBe('local');
  });
});
