/** @vitest-environment jsdom */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TabData } from '../../types';
import { useExternalSqlFileDrop } from './useExternalSqlFileDrop';

const runtimeApi = vi.hoisted(() => ({
  OnFileDrop: vi.fn(),
  OnFileDropOff: vi.fn(),
}));

const messageApi = vi.hoisted(() => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

const storeApi = vi.hoisted(() => ({
  tabs: [] as TabData[],
  externalSQLDirectories: [] as unknown[],
  activeTabId: 'tab-active',
  addTab: vi.fn(),
  setActiveTab: vi.fn(),
}));

vi.mock('../../../wailsjs/runtime', () => runtimeApi);
vi.mock('../../../wailsjs/go/app/App', () => ({
  ReadSQLFile: vi.fn(),
}));
vi.mock('antd', () => ({
  message: messageApi,
}));
vi.mock('../../store', () => ({
  useStore: {
    getState: () => storeApi,
  },
}));
vi.mock('../../i18n', () => ({
  t: (key: string, params?: Record<string, string>) => (
    params ? `${key}:${Object.values(params).join('|')}` : key
  ),
}));

const Harness = () => {
  useExternalSqlFileDrop();
  return null;
};

const triggerDrop = async (paths: string[]) => {
  const callback = runtimeApi.OnFileDrop.mock.calls[0]?.[0] as
    | ((x: number, y: number, paths: string[]) => void)
    | undefined;
  expect(callback).toBeTypeOf('function');
  await act(async () => {
    callback?.(10, 20, paths);
  });
};

describe('useExternalSqlFileDrop', () => {
  let renderers: ReactTestRenderer[];

  const mount = async (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      let renderer: ReactTestRenderer;
      await act(async () => {
        renderer = create(<Harness />);
      });
      renderers.push(renderer!);
    }
  };

  const unmountAll = async () => {
    for (const renderer of renderers.splice(0)) {
      await act(async () => {
        renderer.unmount();
      });
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    renderers = [];
    storeApi.tabs = [];
    storeApi.externalSQLDirectories = [];
    storeApi.activeTabId = 'tab-active';
    // hook 的守卫读取 window.runtime（Wails 注入的全局运行时），测试里手动提供
    (window as unknown as { runtime?: unknown }).runtime = {
      OnFileDrop: () => {},
      OnFileDropOff: () => {},
    };
  });

  afterEach(async () => {
    await unmountAll();
    delete (window as unknown as { runtime?: unknown }).runtime;
  });

  it('Wails 运行时不可用时不注册', async () => {
    delete (window as unknown as { runtime?: unknown }).runtime;
    await mount();
    expect(runtimeApi.OnFileDrop).not.toHaveBeenCalled();
    expect(runtimeApi.OnFileDropOff).not.toHaveBeenCalled();
  });

  it('多个编辑器实例只注册一次，全部卸载后清理', async () => {
    await mount(3);
    expect(runtimeApi.OnFileDrop).toHaveBeenCalledTimes(1);
    expect(runtimeApi.OnFileDrop).toHaveBeenCalledWith(expect.any(Function), true);

    await unmountAll();
    expect(runtimeApi.OnFileDropOff).toHaveBeenCalledTimes(1);

    // 清理后重新挂载可以再次注册（例如关闭全部标签页后再开新查询）
    await mount();
    expect(runtimeApi.OnFileDrop).toHaveBeenCalledTimes(2);
  });

  it('部分实例卸载不影响剩余实例的注册', async () => {
    await mount(2);
    await act(async () => {
      renderers[0].unmount();
    });
    renderers.splice(0, 1);
    expect(runtimeApi.OnFileDropOff).not.toHaveBeenCalled();
  });

  it('拖入非 .sql 文件时给出警告且不读取', async () => {
    const { ReadSQLFile } = await import('../../../wailsjs/go/app/App');
    await mount();
    await triggerDrop(['D:/a.txt', 'D:/b.csv']);
    expect(messageApi.warning).toHaveBeenCalledWith(
      'query_editor.message.external_sql_drop_rejected_files:2|a.txt、b.csv',
    );
    expect(ReadSQLFile).not.toHaveBeenCalled();
    expect(storeApi.addTab).not.toHaveBeenCalled();
  });

  it('拖入 .sql 文件时按稳定顺序读取并创建标签页', async () => {
    const { ReadSQLFile } = await import('../../../wailsjs/go/app/App');
    vi.mocked(ReadSQLFile).mockImplementation(async (filePath: string) => ({
      success: true,
      message: '',
      data: `content of ${filePath}`,
    }));
    storeApi.tabs = [{
      id: 'tab-active',
      title: '查询',
      type: 'query',
      connectionId: 'conn-1',
      dbName: 'app',
      query: '',
    } as TabData];

    await mount();
    await triggerDrop(['D:/z.sql', 'D:/a.sql']);

    expect(ReadSQLFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ReadSQLFile).mock.calls.map(([path]) => path)).toEqual([
      'D:/a.sql',
      'D:/z.sql',
    ]);
    expect(storeApi.addTab).toHaveBeenCalledTimes(2);
    expect(storeApi.addTab.mock.calls[0][0]).toMatchObject({
      type: 'query',
      connectionId: 'conn-1',
      dbName: 'app',
      filePath: 'D:/a.sql',
      query: 'content of D:/a.sql',
    });
  });

  it('混合拖入时拒绝提示与打开流程同时生效', async () => {
    const { ReadSQLFile } = await import('../../../wailsjs/go/app/App');
    vi.mocked(ReadSQLFile).mockResolvedValue({ success: true, message: '', data: 'SELECT 1' });
    await mount();
    await triggerDrop(['D:/keep.sql', 'D:/skip.txt']);
    expect(messageApi.warning).toHaveBeenCalledTimes(1);
    expect(ReadSQLFile).toHaveBeenCalledTimes(1);
    expect(ReadSQLFile).toHaveBeenCalledWith('D:/keep.sql');
  });
});
