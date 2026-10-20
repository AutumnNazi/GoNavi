import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBrandIconSync } from './useBrandIconSync';
import type { BrandIconId } from './brandIcons';

const messageApi = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

const modalConfirm = vi.hoisted(() => vi.fn());
const restartApplication = vi.hoisted(() =>
  vi.fn(async (): Promise<{ success: boolean; message?: string }> => ({ success: true })));

const storeState = vi.hoisted(() => ({
  brandIconId: 'legacy',
  setBrandIconId: (_id: string) => {},
}));

const setApplicationBrandIcon = vi.hoisted(() => vi.fn());

const ensureBrandAssetsMock = vi.hoisted(() => vi.fn(async () => true));
const composeMacOSDockIcon = vi.hoisted(() => vi.fn(async () => 'b64'));
const composeWindowsNativeIcon = vi.hoisted(() => vi.fn(async () => 'b64'));
// 可配置的运行环境与品牌定义：默认保持原生同步不触发，避免影响既有用例。
const environmentState = vi.hoisted(() => ({ shouldSync: false, platform: 'windows' }));
const brandDefinitionState = vi.hoisted(() => ({
  value: { mascot: true } as { mascot?: boolean; bundled?: boolean },
}));
// Windows 原生合成的取景缩放：按 id 返回（捕获传错 id 的回归），默认 1。
const nativeIconZoomState = vi.hoisted(() => ({ forId: '', value: 1 }));

vi.mock('antd', () => ({ message: messageApi, Modal: { confirm: modalConfirm } }));
vi.mock('../store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector(storeState),
}));
vi.mock('../../wailsjs/go/app/App', () => ({
  SetApplicationBrandIcon: setApplicationBrandIcon,
  RestartApplication: restartApplication,
  GetBrandIconDataURL: vi.fn(),
}));
vi.mock('../../wailsjs/runtime', () => ({
  Environment: vi.fn(async () => ({ platform: environmentState.platform, buildType: 'production' })),
}));
vi.mock('../i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => key, language: 'zh-CN' }),
}));
vi.mock('./brandIcons', () => ({
  resolveBrandIconSrc: () => 'asset:icon',
  resolveBrandDockSrc: (id: string) => `dock:${id}`,
  resolveBrandNativeSrc: (id: string) => `dock:${id}`,
  resolveBrandNativeIconZoom: (id: unknown) =>
    String(id) === nativeIconZoomState.forId ? nativeIconZoomState.value : 1,
  resolveBrandIcon: () => brandDefinitionState.value,
  brandAssetKeysFor: () => [],
  startupBrandAssetKeys: () => ['startup-keys'],
  previewBrandAssetKeys: () => ['preview-keys'],
}));
vi.mock('./brandAssetLoader', () => ({
  ensureBrandAssets: ensureBrandAssetsMock,
  subscribeBrandAssets: () => () => {},
  getBrandAssetsRevision: () => 0,
}));
vi.mock('./macDockIcon', () => ({
  composeWindowsNativeIconBase64: composeWindowsNativeIcon,
  composeMacOSDockIconBase64: composeMacOSDockIcon,
  APPLE_DOCK_ICON_GRID_INSET: 100,
  shouldSyncApplicationBrandIcon: () => environmentState.shouldSync,
}));

let capturedHandler: (id: BrandIconId) => Promise<void>;

const Harness = (): null => {
  const { handleBrandIconChange } = useBrandIconSync('windows');
  capturedHandler = handleBrandIconChange;
  return null;
};

describe('useBrandIconSync startup asset prefetch', () => {
  beforeEach(() => {
    ensureBrandAssetsMock.mockClear();
  });

  it('prefetches startup keys and the full picker preview set on mount', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await act(async () => {});
    void renderer;

    expect(ensureBrandAssetsMock).toHaveBeenCalledWith(['startup-keys']);
    // 首装首次打开选择器时吉祥物必须已就绪或处于骨架态，
    // 不能渲染深色兜底剪影——启动即后台补齐全部预览资源。
    expect(ensureBrandAssetsMock).toHaveBeenCalledWith(['preview-keys']);
  });
});

describe('useBrandIconSync handleBrandIconChange', () => {
  beforeEach(() => {
    messageApi.success.mockClear();
    messageApi.warning.mockClear();
    messageApi.error.mockClear();
    modalConfirm.mockClear();
    restartApplication.mockReset();
    restartApplication.mockResolvedValue({ success: true });
    setApplicationBrandIcon.mockReset();
    nativeIconZoomState.forId = '';
    nativeIconZoomState.value = 1;
    storeState.brandIconId = 'legacy';
    storeState.setBrandIconId = (id: string) => { storeState.brandIconId = id; };
    vi.spyOn(storeState, 'setBrandIconId');
  });

  // 审查发现的回归场景：A 在途失败时用户已改选 B，无条件回退会把过期的
  // previousId 写回 store，选择器与已成功应用的原生表面脱节。
  it('does not revert to a stale previous id when a newer selection took over', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    let rejectInFlight!: (error: Error) => void;
    setApplicationBrandIcon.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectInFlight = reject; }),
    );
    const firstApply = capturedHandler('aurora' as BrandIconId);

    setApplicationBrandIcon.mockImplementationOnce(async () => ({ success: true }));
    await act(async () => {
      await capturedHandler('nova' as BrandIconId);
    });
    rejectInFlight(new Error('superseded'));
    await act(async () => {
      await firstApply;
    });
    void renderer;

    expect(storeState.setBrandIconId).toHaveBeenCalledTimes(2);
    expect(storeState.setBrandIconId).toHaveBeenNthCalledWith(1, 'aurora');
    expect(storeState.setBrandIconId).toHaveBeenNthCalledWith(2, 'nova');
    expect(messageApi.error).toHaveBeenCalledTimes(1);
  });

  it('reverts to the previous id when the apply fails without a newer selection', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    setApplicationBrandIcon.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    await act(async () => {
      await capturedHandler('aurora' as BrandIconId);
    });
    void renderer;

    expect(storeState.setBrandIconId).toHaveBeenCalledTimes(2);
    expect(storeState.setBrandIconId).toHaveBeenNthCalledWith(1, 'aurora');
    expect(storeState.setBrandIconId).toHaveBeenNthCalledWith(2, 'legacy');
    expect(messageApi.error).toHaveBeenCalledTimes(1);
  });

  it('reports success and keeps the selection when the apply succeeds', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    setApplicationBrandIcon.mockImplementationOnce(async () => ({ success: true }));
    await act(async () => {
      await capturedHandler('aurora' as BrandIconId);
    });
    void renderer;

    expect(storeState.setBrandIconId).toHaveBeenCalledTimes(1);
    expect(storeState.setBrandIconId).toHaveBeenCalledWith('aurora');
    expect(messageApi.success).toHaveBeenCalledTimes(1);
    expect(messageApi.error).not.toHaveBeenCalled();
  });

  it('passes the asset-family native zoom into the Windows tile composition', async () => {
    // forId 限定让 mock 只对被选 id 生效：实现若误传 previousId 或别的
    // id，这里会拿到 1 而不是 1.25，断言即失败。
    nativeIconZoomState.forId = 'aurora';
    nativeIconZoomState.value = 1.25;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    setApplicationBrandIcon.mockImplementationOnce(async () => ({ success: true }));
    await act(async () => {
      await capturedHandler('aurora' as BrandIconId);
    });
    void renderer;

    expect(composeWindowsNativeIcon).toHaveBeenCalledWith('dock:aurora', { zoom: 1.25 });
    expect(setApplicationBrandIcon).toHaveBeenCalledWith('b64');
  });

  it('prompts a restart only when the backend reports restartRecommended', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    // 正常成功（无标记）：不弹重启引导。
    setApplicationBrandIcon.mockImplementationOnce(async () => ({ success: true }));
    await act(async () => {
      await capturedHandler('aurora' as BrandIconId);
    });
    expect(modalConfirm).not.toHaveBeenCalled();

    // 固定项按钮重建失败（后端标记 restartRecommended）：弹重启引导。
    setApplicationBrandIcon.mockImplementationOnce(async () => ({
      success: true,
      data: { restartRecommended: true },
    }));
    await act(async () => {
      await capturedHandler('ember' as BrandIconId);
    });
    expect(modalConfirm).toHaveBeenCalledTimes(1);
    expect(modalConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'app.settings.entry.brand_icon.windows_restart.title',
      content: 'app.settings.entry.brand_icon.windows_restart.description',
      okText: 'app.settings.entry.brand_icon.windows_restart.now',
      cancelText: 'app.settings.entry.brand_icon.windows_restart.later',
    }));
    // 点「马上重启」才调 RestartApplication。
    const onOk = modalConfirm.mock.calls[0][0].onOk as () => void;
    await act(async () => { onOk(); });
    expect(restartApplication).toHaveBeenCalledTimes(1);
    void renderer;
  });

  // 审查发现的回归场景：连续两次切换都重建失败时，antd 静态 confirm 每次
  // 调用都新建实例，不设防会叠加两个确认框。关闭（afterClose）后才允许再弹。
  it('keeps a single restart confirm across consecutive rebuild failures', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    const applyWithRestartFlag = async () => {
      setApplicationBrandIcon.mockImplementationOnce(async () => ({
        success: true,
        data: { restartRecommended: true },
      }));
      await act(async () => {
        await capturedHandler('aurora' as BrandIconId);
      });
    };

    await applyWithRestartFlag();
    await applyWithRestartFlag();
    expect(modalConfirm).toHaveBeenCalledTimes(1);

    // 用户关闭弹窗（确定/取消最终都触发 afterClose）后，下一次失败可以再弹。
    const afterClose = modalConfirm.mock.calls[0][0].afterClose as () => void;
    afterClose();
    await applyWithRestartFlag();
    expect(modalConfirm).toHaveBeenCalledTimes(2);
    void renderer;
  });

  // RestartApplication 返回 QueryResult 不抛异常：子进程拉起失败必须显式
  // 报错，否则用户以为在重启、实际毫无动静。
  it('surfaces a restart failure instead of swallowing it', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    setApplicationBrandIcon.mockImplementationOnce(async () => ({
      success: true,
      data: { restartRecommended: true },
    }));
    await act(async () => {
      await capturedHandler('aurora' as BrandIconId);
    });
    restartApplication.mockResolvedValueOnce({ success: false, message: 'spawn failed' });

    const onOk = modalConfirm.mock.calls[0][0].onOk as () => Promise<void>;
    await act(async () => { await onOk(); });
    expect(restartApplication).toHaveBeenCalledTimes(1);
    expect(messageApi.error).toHaveBeenCalledWith('spawn failed');
    void renderer;
  });
});

describe('useBrandIconSync native dock icon composition', () => {
  const DarwinHarness = (): null => {
    useBrandIconSync('darwin');
    return null;
  };

  beforeEach(() => {
    storeState.brandIconId = 'legacy';
    setApplicationBrandIcon.mockReset();
    setApplicationBrandIcon.mockResolvedValue({ success: true });
    composeMacOSDockIcon.mockClear();
    composeWindowsNativeIcon.mockClear();
    environmentState.shouldSync = true;
    environmentState.platform = 'darwin';
    brandDefinitionState.value = { mascot: false, bundled: true };
    // node 测试环境没有 document：提供最小的 favicon 存根，
    // 让同步 effect 越过入口守卫走到原生合成。
    vi.stubGlobal('document', {
      querySelector: () => null,
      createElement: () => ({ setAttribute: () => {} }),
      head: { appendChild: () => {} },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    environmentState.shouldSync = false;
    environmentState.platform = 'windows';
    brandDefinitionState.value = { mascot: true };
  });

  it('composes every family onto the strict Apple grid on macOS', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(DarwinHarness));
    });
    await act(async () => {});
    void renderer;

    expect(composeMacOSDockIcon).toHaveBeenCalledTimes(1);
    // zoom 走 mock 默认值 1：接线测试只验证参数透传，真实家族取值（缎带
    // 1.25）由 brandIcons.test 锁定，这里不重复。
    expect(composeMacOSDockIcon).toHaveBeenCalledWith('dock:legacy', {
      inset: 100,
      zoom: 1,
      fillTileBackground: false,
    });
    expect(composeWindowsNativeIcon).not.toHaveBeenCalled();
    expect(setApplicationBrandIcon).toHaveBeenCalledWith('b64');
  });

  it('keeps the mascot white-tile base and family zoom on the Apple grid', async () => {
    brandDefinitionState.value = { mascot: true, bundled: false };
    nativeIconZoomState.forId = 'legacy';
    nativeIconZoomState.value = 1.25;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(DarwinHarness));
    });
    await act(async () => {});
    void renderer;

    expect(composeMacOSDockIcon).toHaveBeenCalledTimes(1);
    expect(composeMacOSDockIcon).toHaveBeenCalledWith('dock:legacy', {
      inset: 100,
      zoom: 1.25,
      fillTileBackground: true,
    });
    expect(setApplicationBrandIcon).toHaveBeenCalledWith('b64');
  });
});
