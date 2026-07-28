import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NacosServiceViewer from './NacosServiceViewer';

const storeState = vi.hoisted(() => ({
  connections: [{
    id: 'nacos-1',
    name: 'nacos',
    config: { type: 'nacos', host: '127.0.0.1', port: 8848 },
  }],
  theme: 'light',
  appearance: {
    uiVersion: 'v2',
    enabled: true,
    opacity: 1,
    blur: 0,
    useNativeMacWindowControls: false,
  },
}));

const nacosBackend = vi.hoisted(() => ({
  NacosListServices: vi.fn(),
  NacosListInstances: vi.fn(),
  NacosDeleteService: vi.fn(),
}));

const antdState = vi.hoisted(() => ({
  tableProps: [] as any[],
  message: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('../i18n/provider', () => ({
  useOptionalI18n: () => ({ language: 'en-US' }),
}));

vi.mock('./RedisResizableDivider', async () => {
  const ReactModule = await import('react');
  return { default: () => ReactModule.createElement('nacos-divider') };
});

vi.mock('@ant-design/icons', async () => {
  const ReactModule = await import('react');
  const Icon = () => ReactModule.createElement('span', { 'data-icon': true });
  return {
    DeleteOutlined: Icon,
    PlusOutlined: Icon,
    ReloadOutlined: Icon,
  };
});

vi.mock('antd', async () => {
  const ReactModule = await import('react');
  const passthrough = (tag: string) => ({ children, ...props }: any) =>
    ReactModule.createElement(tag, props, children);
  const Form = Object.assign(
    passthrough('form'),
    {
      Item: passthrough('form-item'),
      useForm: () => [{
        validateFields: vi.fn(),
        resetFields: vi.fn(),
        setFieldsValue: vi.fn(),
      }],
    },
  );

  return {
    Button: ({ children, ...props }: any) => ReactModule.createElement('button', props, children),
    Form,
    Input: (props: any) => ReactModule.createElement('input', props),
    InputNumber: (props: any) => ReactModule.createElement('input-number', props),
    Modal: ({ open, children, ...props }: any) => open
      ? ReactModule.createElement('modal', props, children)
      : null,
    Popconfirm: ({ children, ...props }: any) =>
      ReactModule.createElement('popconfirm', props, children),
    Space: passthrough('space'),
    Switch: (props: any) => ReactModule.createElement('switch-control', props),
    Table: (props: any) => {
      antdState.tableProps.push(props);
      return ReactModule.createElement('nacos-table');
    },
    Tag: passthrough('tag'),
    message: antdState.message,
  };
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const latestServiceTableProps = () =>
  [...antdState.tableProps].reverse().find((props) => props.pagination !== false);

const latestInstanceTableProps = () =>
  [...antdState.tableProps].reverse().find((props) => props.pagination === false);

describe('NacosServiceViewer instance request ordering', () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    antdState.tableProps = [];
    nacosBackend.NacosListServices.mockResolvedValue({
      success: true,
      data: {
        count: 3,
        pageNo: 1,
        pageSize: 50,
        serviceNames: ['GROUP_A@@alpha', 'GROUP_B@@beta', 'GROUP_C@@charlie'],
      },
    });
    nacosBackend.NacosDeleteService.mockResolvedValue({ success: true });
    vi.stubGlobal('window', {
      go: { app: { App: nacosBackend } },
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
    vi.unstubAllGlobals();
  });

  it('clears stale instances and ignores responses from an older service selection', async () => {
    const betaResponse = deferred<any>();
    const charlieResponse = deferred<any>();
    nacosBackend.NacosListInstances.mockImplementation(
      async (_config: unknown, payload: { serviceName: string }) => {
        if (payload.serviceName === 'alpha') {
          return {
            success: true,
            data: { hosts: [{ ip: '10.0.0.1', port: 8080, healthy: true, enabled: true, ephemeral: true }] },
          };
        }
        if (payload.serviceName === 'beta') return betaResponse.promise;
        return charlieResponse.promise;
      },
    );

    await act(async () => {
      renderer = create(
        <NacosServiceViewer connectionId="nacos-1" namespaceId="dev" namespaceName="dev" />,
      );
    });
    await flushEffects();

    const serviceTable = latestServiceTableProps();
    await act(async () => {
      serviceTable.onRow(serviceTable.dataSource[0]).onClick();
    });
    await flushEffects();
    expect(latestInstanceTableProps().dataSource).toEqual([
      expect.objectContaining({ ip: '10.0.0.1' }),
    ]);

    await act(async () => {
      serviceTable.onRow(serviceTable.dataSource[1]).onClick();
    });
    expect(latestInstanceTableProps().dataSource).toEqual([]);

    await act(async () => {
      serviceTable.onRow(serviceTable.dataSource[2]).onClick();
    });
    charlieResponse.resolve({
      success: true,
      data: { hosts: [{ ip: '10.0.0.3', port: 8080, healthy: true, enabled: true, ephemeral: true }] },
    });
    await flushEffects();
    expect(latestInstanceTableProps().dataSource).toEqual([
      expect.objectContaining({ ip: '10.0.0.3' }),
    ]);
    expect(latestInstanceTableProps().loading).toBe(false);

    betaResponse.resolve({
      success: true,
      data: { hosts: [{ ip: '10.0.0.2', port: 8080, healthy: true, enabled: true, ephemeral: true }] },
    });
    await flushEffects();
    expect(latestInstanceTableProps().dataSource).toEqual([
      expect.objectContaining({ ip: '10.0.0.3' }),
    ]);
    expect(latestInstanceTableProps().loading).toBe(false);

  });

  it('notifies the sidebar after a service is deleted', async () => {
    nacosBackend.NacosListInstances.mockResolvedValue({ success: true, data: { hosts: [] } });

    await act(async () => {
      renderer = create(
        <NacosServiceViewer connectionId="nacos-1" namespaceId="dev" namespaceName="dev" />,
      );
    });
    await flushEffects();

    const serviceTable = latestServiceTableProps();
    const deleteAction = serviceTable.columns[1].render(undefined, serviceTable.dataSource[0]);
    await act(async () => {
      deleteAction.props.onConfirm();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(window.dispatchEvent).mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('gonavi:nacos-services-changed');
    expect(event.detail).toEqual({ connectionId: 'nacos-1', namespaceId: 'dev' });
  });
});
