import { describe, expect, it } from 'vitest';

import { isNativeDetachedWindowRoute } from './nativeDetachedWindowRoute';

describe('native detached frontend entry routing', () => {
  it('routes injected child runtimes to the detached entry', () => {
    expect(isNativeDetachedWindowRoute({ __GONAVI_DETACHED__: { active: true } }, {
      pathname: '/',
      search: '',
    })).toBe(true);
  });

  it('routes detached paths and explicit query flags to the detached entry', () => {
    expect(isNativeDetachedWindowRoute({}, {
      pathname: '/__gonavi/detached/window/workbench-1',
      search: '',
    })).toBe(true);
    expect(isNativeDetachedWindowRoute({}, {
      pathname: '/',
      search: '?__gonavi_detached=1',
    })).toBe(true);
  });

  it('keeps the normal app on the main entry', () => {
    expect(isNativeDetachedWindowRoute({}, {
      pathname: '/',
      search: '',
    })).toBe(false);
  });
});
