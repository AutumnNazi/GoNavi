// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock 会被提升到文件顶部，mock 对象必须用 vi.hoisted 先建出来。
const rpcMock = vi.hoisted(() => ({
  listJobGroups: vi.fn(),
  listJobs: vi.fn(),
  listLogs: vi.fn(),
  nextTriggerTimes: vi.fn(),
  triggerJob: vi.fn(),
  startJobs: vi.fn(),
  stopJobs: vi.fn(),
  logDetail: vi.fn(),
  logKill: vi.fn(),
}));

vi.mock('./xxljobRpc', () => ({ xxlJobRpc: rpcMock }));

const baseConnection = {
  id: 'c1',
  name: 'xxl',
  config: { type: 'xxljob', host: '127.0.0.1', port: 8080, user: 'admin', password: 'x' },
};

let storeState: { connections: unknown[] } = { connections: [baseConnection] };
vi.mock('../../store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector(storeState),
}));

vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../utils/connectionRpcConfig', () => ({
  buildRpcConnectionConfig: (config: unknown) => config,
}));

import { XxlJobGroupPanel } from './XxlJobGroupPanel';
import { XxlJobJobPanel } from './XxlJobJobPanel';
import { XxlJobLogPanel } from './XxlJobLogPanel';

const page = (rows: unknown[]) => ({ success: true, data: { page: 1, size: 20, total: rows.length, rows } });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  // antd 的 responsiveObserver 以函数方式调用 matchMedia，这里必须给函数而不是类。
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  storeState = { connections: [baseConnection] };
  rpcMock.listJobGroups.mockResolvedValue(page([]));
  rpcMock.listJobs.mockResolvedValue(page([]));
  rpcMock.listLogs.mockResolvedValue(page([]));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// 渲染后把挂起的 Promise 解析推进 act，避免状态更新落在断言之外。
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const renderPanel = (element: React.ReactElement) => {
  act(() => root.render(element));
};

// antd 的 fixed 列会复制一份表格，按 tbody 序号取行并不可靠；
// 这里按行内文本定位，重复表格里命中的是同一份数据。
const rowsMatching = (predicate: (text: string) => boolean): HTMLElement[] =>
  Array.from(container.querySelectorAll('tr'))
    .filter((row) => predicate((row.textContent || '').replace(/\s+/g, ' ').trim()));

const rowContaining = (label: string): HTMLElement => {
  const hit = rowsMatching((text) => text.includes(label))[0];
  if (!hit) throw new Error(`row containing ${label} not found`);
  return hit;
};

const rowWithId = (id: string): HTMLElement => {
  const hit = rowsMatching((text) => text.startsWith(id))[0];
  if (!hit) throw new Error(`row with id ${id} not found`);
  return hit;
};

const buttonIn = (row: HTMLElement, label: string): HTMLButtonElement => {
  const hit = Array.from(row.querySelectorAll('button'))
    .find((button) => (button.textContent || '').includes(label));
  if (!hit) throw new Error(`button ${label} not found in row`);
  return hit;
};

const textOf = (label: string): HTMLElement | null => {
  const node = Array.from(container.querySelectorAll('*'))
    .find((el) => el.textContent?.trim() === label);
  return (node as HTMLElement) ?? null;
};

const buttonFor = (label: string): HTMLButtonElement | null => {
  const buttons = Array.from(container.querySelectorAll('button'));
  return buttons.find((button) => button.textContent?.includes(label) || button.getAttribute('aria-label') === label) ?? null;
};

describe('XXL-JOB 执行器面板', () => {
  it('空列表渲染空态文案而不是错误', async () => {
    renderPanel(<XxlJobGroupPanel connectionId="c1" isActive />);
    await flush();
    expect(container.textContent).toContain('xxljob.empty.groups');
    expect(rpcMock.listJobGroups).toHaveBeenCalledTimes(1);
  });

  it('展示执行器名称、注册方式与注册节点', async () => {
    rpcMock.listJobGroups.mockResolvedValue(page([{
      id: 1,
      appName: 'xxl-job-executor-sample',
      title: 'Sample Executor',
      addressType: 0,
      registryList: [{ registryKey: 'http://172.23.0.5:9999/' }],
    }]));
    renderPanel(<XxlJobGroupPanel connectionId="c1" isActive />);
    await flush();
    expect(container.textContent).toContain('Sample Executor');
    expect(container.textContent).toContain('http://172.23.0.5:9999/');
    expect(container.textContent).toContain('xxljob.value.register_auto');
  });

  it('保留后端错误文案，便于区分空数据与读不到数据', async () => {
    rpcMock.listJobGroups.mockResolvedValue({ success: false, message: 'session expired' });
    renderPanel(<XxlJobGroupPanel connectionId="c1" isActive />);
    await flush();
    expect(container.textContent).toContain('session expired');
  });

  it('非活跃标签页不发起请求', async () => {
    renderPanel(<XxlJobGroupPanel connectionId="c1" isActive={false} />);
    await flush();
    expect(rpcMock.listJobGroups).not.toHaveBeenCalled();
  });
});

describe('XXL-JOB 任务面板', () => {
  it('只读连接禁用启停与执行一次，并给出提示', async () => {
    storeState = {
      connections: [{ ...baseConnection, config: { ...baseConnection.config, readOnly: true } }],
    };
    rpcMock.listJobs.mockResolvedValue(page([{
      id: 3, jobGroup: 1, name: 'sleepJob', triggerStatus: 1, executorHandler: 'commandJobHandler',
    }]));
    renderPanel(<XxlJobJobPanel connectionId="c1" isActive />);
    await flush();
    expect(container.textContent).toContain('xxljob.hint.readonly');
    expect(buttonFor('xxljob.action.start')?.disabled).toBe(true);
    expect(buttonFor('xxljob.action.stop')?.disabled).toBe(true);
    // 执行一次是图标按钮，aria-label 承载动作名；只读下必须同样禁用。
    const triggerButton = buttonFor('xxljob.action.trigger');
    expect(triggerButton?.disabled).toBe(true);
  });

  it('运行中的任务只能停止，已停止的任务只能启动', async () => {
    rpcMock.listJobs.mockResolvedValue(page([
      { id: 3, jobGroup: 1, name: 'runningJob', triggerStatus: 1, executorHandler: 'commandJobHandler' },
      { id: 4, jobGroup: 1, name: 'stoppedJob', triggerStatus: 0, executorHandler: 'demoJobHandler' },
    ]));
    renderPanel(<XxlJobJobPanel connectionId="c1" isActive />);
    await flush();
    const runningRow = rowContaining('runningJob');
    const stoppedRow = rowContaining('stoppedJob');
    // 运行中：开始禁用、停止可用
    expect(buttonIn(runningRow, 'xxljob.action.start').disabled).toBe(true);
    expect(buttonIn(runningRow, 'xxljob.action.stop').disabled).toBe(false);
    // 已停止：开始可用、停止禁用
    expect(buttonIn(stoppedRow, 'xxljob.action.start').disabled).toBe(false);
    expect(buttonIn(stoppedRow, 'xxljob.action.stop').disabled).toBe(true);
  });

  it('执行一次把可选参数传给后端', async () => {
    rpcMock.listJobs.mockResolvedValue(page([{
      id: 3, jobGroup: 1, name: 'sleepJob', triggerStatus: 0, executorHandler: 'commandJobHandler',
    }]));
    rpcMock.triggerJob.mockResolvedValue({ success: true, message: 'ok' });
    renderPanel(<XxlJobJobPanel connectionId="c1" isActive />);
    await flush();

    const triggerButton = rowContaining('sleepJob').querySelector('button');
    await act(async () => { triggerButton?.click(); });
    await act(async () => { await Promise.resolve(); });

    // Modal 渲染在 portal 里，必须到 document.body 上找确定按钮。
    const okButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => (button.textContent || '').includes('xxljob.action.confirm'));
    expect(okButton).toBeTruthy();
    await act(async () => { okButton?.click(); });
    await flush();

    expect(rpcMock.triggerJob).toHaveBeenCalled();
    const [, jobId, param] = rpcMock.triggerJob.mock.calls[0];
    expect(jobId).toBe(3);
    expect(typeof param).toBe('string');
  });

  it('无调度规则的任务不请求下次触发时间', async () => {
    rpcMock.listJobs.mockResolvedValue(page([{
      id: 5, jobGroup: 1, name: 'manualJob', triggerStatus: 0, executorHandler: 'commandJobHandler',
    }]));
    renderPanel(<XxlJobJobPanel connectionId="c1" isActive />);
    await flush();
    const nextButton = buttonIn(rowContaining('manualJob'), 'xxljob.action.next_times');
    await act(async () => { nextButton.click(); });
    await flush();
    expect(rpcMock.nextTriggerTimes).not.toHaveBeenCalled();
  });
});

describe('XXL-JOB 调度日志面板', () => {
  it('非运行中的记录禁用终止，运行中的启用', async () => {
    rpcMock.listLogs.mockResolvedValue(page([
      { id: 10, jobId: 1, triggerCode: 200, handleCode: 200 },
      { id: 11, jobId: 1, triggerCode: 200, handleCode: 0 },
    ]));
    renderPanel(<XxlJobLogPanel connectionId="c1" isActive />);
    await flush();
    const finished = rowWithId('10');
    const running = rowWithId('11');
    expect(buttonIn(finished, 'xxljob.action.kill').disabled).toBe(true);
    expect(buttonIn(running, 'xxljob.action.kill').disabled).toBe(false);
  });

  it('只读连接下即使运行中也禁用终止', async () => {
    storeState = {
      connections: [{
        ...baseConnection,
        config: { ...baseConnection.config, protection: { restrictScriptExecution: true } },
      }],
    };
    rpcMock.listLogs.mockResolvedValue(page([{ id: 11, jobId: 1, triggerCode: 200, handleCode: 0 }]));
    renderPanel(<XxlJobLogPanel connectionId="c1" isActive />);
    await flush();
    expect(buttonIn(rowWithId('11'), 'xxljob.action.kill').disabled).toBe(true);
  });

  it('空列表渲染空态', async () => {
    renderPanel(<XxlJobLogPanel connectionId="c1" isActive />);
    await flush();
    expect(container.textContent).toContain('xxljob.empty.logs');
  });
});
