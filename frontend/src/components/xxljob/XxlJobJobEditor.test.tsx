// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock 会被提升到文件顶部，mock 对象必须用 vi.hoisted 先建出来。
const rpcMock = vi.hoisted(() => ({
  listJobGroups: vi.fn(),
  listJobs: vi.fn(),
  saveJob: vi.fn(),
  deleteJobs: vi.fn(),
  saveJobGroup: vi.fn(),
  deleteJobGroups: vi.fn(),
  nextTriggerTimes: vi.fn(),
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

import { XxlJobJobPanel } from './XxlJobJobPanel';
import { XxlJobGroupPanel } from './XxlJobGroupPanel';
import {
  buildJobFormValues,
  buildJobMutationPayload,
  emptyJobFormValues,
  validateScheduleConf,
} from './xxljobJobEditor';

const page = (rows: unknown[]) => ({ success: true, data: { page: 1, size: 20, total: rows.length, rows } });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
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
  rpcMock.listJobGroups.mockResolvedValue(page([
    { id: 1, appName: 'sample', title: 'Sample', addressType: 0, addressList: '' },
  ]));
  rpcMock.listJobs.mockResolvedValue(page([
    {
      id: 3, jobGroup: 1, name: 'demoJob', author: 'admin', alarmEmail: 'ops@example.com',
      scheduleType: 'CRON', scheduleConf: '0/30 * * * * ?', executorHandler: 'demoJobHandler',
      executorParam: 'p=1', executorRouteStrategy: 'FIRST', executorBlockStrategy: 'SERIAL_EXECUTION',
      executorTimeout: 0, executorFailRetryCount: 0, glueType: 'BEAN', triggerStatus: 1,
    },
  ]));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const renderPanel = (element: React.ReactElement) => {
  act(() => root.render(element));
};

const buttonByLabel = (label: string): HTMLButtonElement | null =>
  Array.from(container.querySelectorAll('button'))
    .find((button) => button.getAttribute('aria-label') === label
      || (button.textContent || '').includes(label)) ?? null;

describe('任务面板：编辑 / 删除 / 新增', () => {
  it('可写连接下渲染新增按钮与更多菜单入口', async () => {
    renderPanel(<XxlJobJobPanel connectionId="c1" isActive />);
    await flush();
    expect(buttonByLabel('xxljob.action.add')).toBeTruthy();
    // 编辑/删除收进 More 菜单，行内只保留 Start/Stop 与菜单入口。
    expect(buttonByLabel('xxljob.action.more')).toBeTruthy();
    expect(buttonByLabel('xxljob.action.edit')).toBeNull();
    expect(buttonByLabel('xxljob.action.delete')).toBeNull();
  });

  it('只读连接下新增按钮禁用', async () => {
    storeState = {
      connections: [{ ...baseConnection, config: { ...baseConnection.config, readOnly: true } }],
    };
    renderPanel(<XxlJobJobPanel connectionId="c1" isActive />);
    await flush();
    expect(buttonByLabel('xxljob.action.add')?.disabled).toBe(true);
  });

  it('任务面板展示官方列：运行模式 / 任务参数 / 阻塞策略 / 负责人', async () => {
    renderPanel(<XxlJobJobPanel connectionId="c1" isActive />);
    await flush();
    expect(container.textContent).toContain('xxljob.column.glue_type');
    expect(container.textContent).toContain('xxljob.column.executor_param');
    expect(container.textContent).toContain('xxljob.column.block_strategy');
    expect(container.textContent).toContain('xxljob.column.author');
    expect(container.textContent).toContain('demoJob');
    expect(container.textContent).toContain('admin');
  });
});

describe('执行器面板：编辑 / 删除 / 新增', () => {
  it('可写连接下渲染新增按钮', async () => {
    renderPanel(<XxlJobGroupPanel connectionId="c1" isActive />);
    await flush();
    expect(buttonByLabel('xxljob.action.add')).toBeTruthy();
  });

  it('只读连接下新增按钮禁用', async () => {
    storeState = {
      connections: [{ ...baseConnection, config: { ...baseConnection.config, readOnly: true } }],
    };
    renderPanel(<XxlJobGroupPanel connectionId="c1" isActive />);
    await flush();
    expect(buttonByLabel('xxljob.action.add')?.disabled).toBe(true);
  });
});

describe('xxljobJobEditor 纯函数', () => {
  it('表单值 → 载荷：BEAN 任务不带 glueSource，GLUE 任务不带 executorHandler', () => {
    const bean = buildJobMutationPayload({
      ...emptyJobFormValues(1),
      name: 'demo', author: 'admin', scheduleType: 'CRON', scheduleConf: '0/30 * * * * ?',
      executorHandler: 'demoJobHandler', glueType: 'BEAN',
    }, 0);
    expect(bean.id).toBe(0);
    expect(bean.glueSource).toBe('');
    expect(bean.executorHandler).toBe('demoJobHandler');

    const glue = buildJobMutationPayload({
      ...emptyJobFormValues(1),
      name: 'demo', author: 'admin', scheduleType: 'CRON', scheduleConf: '0/30 * * * * ?',
      glueType: 'GLUE_SHELL', glueSource: 'echo hi',
    }, 5);
    expect(glue.id).toBe(5);
    expect(glue.executorHandler).toBe('');
    expect(glue.glueSource).toBe('echo hi');
    expect(glue.glueRemark).toBe('GLUE代码初始化');
  });

  it('已有任务 → 表单值回填完整', () => {
    const values = buildJobFormValues({
      id: 3, jobGroup: 1, name: 'demoJob', author: 'admin', alarmEmail: 'ops@example.com',
      scheduleType: 'CRON', scheduleConf: '0/30 * * * * ?', executorHandler: 'demoJobHandler',
      executorParam: 'p=1', executorRouteStrategy: 'FIRST', executorBlockStrategy: 'SERIAL_EXECUTION',
      executorTimeout: 30, executorFailRetryCount: 2, glueType: 'BEAN', triggerStatus: 1,
    });
    expect(values.name).toBe('demoJob');
    expect(values.alarmEmail).toBe('ops@example.com');
    expect(values.executorTimeout).toBe(30);
    expect(values.triggerStatus).toBe(1);
  });

  it('调度配置校验：CRON 必填、FIX_RATE 正整数、NONE 可空', () => {
    expect(validateScheduleConf('CRON', '')).toBe('xxljob.validation.schedule_conf_required');
    expect(validateScheduleConf('FIX_RATE', 'abc')).toBe('xxljob.validation.schedule_conf_fix_rate');
    expect(validateScheduleConf('FIX_RATE', '30')).toBeNull();
    expect(validateScheduleConf('NONE', '')).toBeNull();
    expect(validateScheduleConf('CRON', '0/30 * * * * ?')).toBeNull();
  });
});
