import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { create } from 'react-test-renderer';
import { useQueryEditorParams } from './useQueryEditorParams';

vi.mock('../../../../wailsjs/go/app/App', () => ({
  AnalyzeQueryParameters: vi.fn(async (_config: unknown, _db: string, sql: string) => {
    const names = Array.from(new Set(Array.from(sql.matchAll(/:([a-z_][a-z0-9_]*)/gi)).map((m) => m[1])));
    return {
      supported: true,
      statements: names.map((name, index) => ({ index, text: sql, parameters: [name] })),
      parameterNames: names,
    };
  }),
}));

const baseOptions = {
  config: { type: 'mysql' } as Record<string, unknown>,
  dbName: 'main',
  enabled: true,
};

// react-test-renderer 无 renderHook；用宿主组件承接 hook 返回值。
let latestState: ReturnType<typeof useQueryEditorParams> | null = null;

function HookHost(props: Partial<Parameters<typeof useQueryEditorParams>[0]>) {
  latestState = useQueryEditorParams({ ...baseOptions, sql: '', ...props });
  return null;
}

async function renderParamsHook(props: Partial<Parameters<typeof useQueryEditorParams>[0]> = {}) {
  let renderer;
  await act(async () => {
    renderer = create(<HookHost {...props} />);
  });
  return renderer;
}

describe('useQueryEditorParams', () => {
  it('防抖后返回后端分析结果并暴露缺失参数', async () => {
    await renderParamsHook({ sql: 'SELECT :alpha, :beta' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(latestState).not.toBeNull();
    expect(latestState!.hasParams).toBe(true);
    expect(latestState!.missingNames).toEqual(['alpha', 'beta']);
  });

  it('analyzeNow 立即返回权威结果并刷新面板分析', async () => {
    await renderParamsHook({ sql: 'SELECT 1' });
    await act(async () => {
      await latestState!.analyzeNow('SELECT :day', 'main');
    });
    expect(latestState!.analysis?.parameterNames).toEqual(['day']);
    expect(latestState!.missingNames).toEqual(['day']);
  });

  it('setValue 后缺失清单随之收敛', async () => {
    await renderParamsHook({ sql: 'SELECT :alpha' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    act(() => {
      latestState!.setValue('alpha', { type: 'string', value: 'v' });
    });
    expect(latestState!.missingNames).toEqual([]);
  });

  it('未启用时不产生分析', async () => {
    await renderParamsHook({ sql: 'SELECT :x', enabled: false });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(latestState!.analysis).toBeNull();
  });
});
