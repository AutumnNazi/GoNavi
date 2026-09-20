/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/provider';
import type { LanguagePreference } from '../../i18n/types';
import DMLSnapshotWorkbench from './DMLSnapshotWorkbench';
import type { DMLSnapshotBackend } from './dmlSnapshotRpc';

describe('DMLSnapshotWorkbench', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // antd 的 Table / Descriptions 依赖 ResizeObserver 与 matchMedia，jsdom 不提供。
    (window as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    (window as any).matchMedia = (window as any).matchMedia || (() => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  // 必须真正挂载：数据来自 useEffect，SSR 渲染不会执行副作用，测不到加载路径。
  const renderWorkbench = async (
    backend: DMLSnapshotBackend,
    preference: LanguagePreference = 'en-US',
  ) => {
    await act(async () => {
      root.render(
        <I18nProvider preference={preference} systemLanguages={[preference]} onPreferenceChange={vi.fn()}>
          <DMLSnapshotWorkbench backend={backend} />
        </I18nProvider>,
      );
    });
    return container.innerHTML;
  };

  it('renders a localized empty state with an explanation', async () => {
    const markup = await renderWorkbench({}, 'en-US');

    expect(markup).toContain('Pre-Execution Snapshot Center');
    expect(markup).toContain('Failed to load snapshots');
    // 缺少后端方法属于内部错误：绝不能把内部英文串泄漏到界面上。
    expect(markup).not.toContain('backend method unavailable');
    // 失败时不得同时显示"暂无快照" —— 那会让人误以为快照真的为空。
    expect(markup).not.toContain('No pre-execution snapshots yet');
  });

  it('shows the empty state only after a successful load', async () => {
    const markup = await renderWorkbench({ ListDMLSnapshots: async () => ({ success: true, data: [] }) });

    expect(markup).toContain('No pre-execution snapshots yet');
    expect(markup).toContain('After you edit or delete rows');
    expect(markup).not.toContain('Failed to load snapshots');
  });

  // §6 的风险声明必须在界面上就可见，不能只写在文档里。
  it('states the non-obvious limits before the user relies on it', async () => {
    const markup = await renderWorkbench({}, 'en-US');

    expect(markup).toContain('Before you use this');
    expect(markup).toContain('never executed automatically');
    expect(markup).toContain('overwrites their changes');
    expect(markup).toContain('unique-key or foreign-key conflict');
    expect(markup).toContain('triggers are not restored');
    expect(markup).toContain('retention policy');
  });

  it('renders in Simplified Chinese when that is the preference', async () => {
    const markup = await renderWorkbench(
      { ListDMLSnapshots: async () => ({ success: true, data: [] }) },
      'zh-CN',
    );

    expect(markup).toContain('执行前快照中心');
    expect(markup).toContain('还没有任何执行前快照');
    expect(markup).not.toContain('Pre-Execution Snapshot Center');
  });

  it('lists snapshots returned by the backend and flags the unrestorable ones', async () => {
    const backend: DMLSnapshotBackend = {
      ListDMLSnapshots: async () => ({
        success: true,
        data: [
          {
            id: 'snap-1',
            createdAt: '2026-09-20T10:00:00Z',
            table: 't_pay',
            connection: 'conn-1',
            statementCount: 3,
            cannotFullyRestore: false,
            skippedCount: 0,
          },
          {
            id: 'snap-2',
            createdAt: '2026-09-20T11:00:00Z',
            table: 't_order',
            connection: 'conn-1',
            statementCount: 1,
            cannotFullyRestore: true,
            skippedCount: 2,
          },
        ],
      }),
    };
    const markup = await renderWorkbench(backend, 'en-US');

    expect(markup).toContain('t_pay');
    expect(markup).toContain('t_order');
    expect(markup).toContain('Fully restorable');
    expect(markup).toContain('Not fully restorable');
    // 不能因为有一条可还原就掩盖另一条的不可还原状态。
    expect(markup).not.toContain('No pre-execution snapshots yet');
  });

  it('surfaces the backend-supplied message when listing fails', async () => {
    const backend: DMLSnapshotBackend = {
      ListDMLSnapshots: async () => ({ success: false, message: '磁盘不可写' }),
    };
    const markup = await renderWorkbench(backend, 'zh-CN');

    expect(markup).toContain('磁盘不可写');
  });
});
