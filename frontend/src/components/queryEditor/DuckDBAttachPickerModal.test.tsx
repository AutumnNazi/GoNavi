/** @vitest-environment jsdom */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import DuckDBAttachPickerModal from './DuckDBAttachPickerModal';
import type { SavedConnection } from '../../types';

vi.mock('antd', () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: React.ReactNode; footer?: React.ReactNode }) => (
    open ? <div>{children}{footer}</div> : null
  ),
  Button: ({ children, onClick, ...rest }: { children: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <button onClick={onClick} {...rest}>{children}</button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Switch: ({ checked, onChange }: { checked: boolean; onChange?: (value: boolean) => void }) => (
    <input type="checkbox" data-testid="attach-readonly-switch" checked={checked} onChange={() => onChange?.(!checked)} />
  ),
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Empty: () => <div data-testid="attach-empty" />,
}));

const buildConnection = (overrides: Partial<SavedConnection> & { id: string; name: string }): SavedConnection => ({
  config: { type: 'mysql', host: '10.0.0.1', port: 3306, user: 'u', database: 'orders' },
  ...overrides,
} as SavedConnection);

const connections: SavedConnection[] = [
  buildConnection({ id: 'conn-uuid-1', name: '生产库-订单' }),
  buildConnection({ id: 'conn-uuid-2', name: '数仓', config: { type: 'postgres' } as SavedConnection['config'] }),
  buildConnection({ id: 'conn-uuid-3', name: 'Oracle 库', config: { type: 'oracle' } as SavedConnection['config'] }),
];

const findButton = (renderer: ReactTestRenderer, testDataId: string) =>
  renderer.root.find((node) => node.props['data-duckdb-attach-item'] === testDataId);

const clickInsert = async (renderer: ReactTestRenderer): Promise<void> => {
  const insertButton = renderer.root.find(
    (node) => node.props['data-duckdb-attach-insert'] === 'true',
  ) as { props: { disabled: boolean; onClick: () => void } };
  expect(insertButton.props.disabled).toBe(false);
  await act(async () => {
    insertButton.props.onClick();
  });
};

describe('DuckDBAttachPickerModal', () => {
  it('renders candidates, marks unsupported types disabled, and builds the insert statement', async () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(DuckDBAttachPickerModal, {
        open: true,
        connections,
        darkMode: false,
        onClose,
        onInsert,
      }));
    });

    // 不支持类型禁用
    expect((findButton(renderer!, 'conn-uuid-3') as { props: { disabled: boolean } }).props.disabled).toBe(true);
    // 支持类型可选
    await act(async () => {
      (findButton(renderer!, 'conn-uuid-1') as { props: { onClick: () => void } }).props.onClick();
    });

    // 默认只读 + 别名自动派生（中文名 → saved_db_<ID 片段>）
    await clickInsert(renderer!);

    expect(onInsert).toHaveBeenCalledWith("ATTACH SAVED CONNECTION 'conn-uuid-1' AS saved_db_conn_uui READ ONLY");
    expect(onClose).toHaveBeenCalled();
  });

  it('inserts a read-write statement with a custom alias when the switch is off', async () => {
    const onInsert = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(React.createElement(DuckDBAttachPickerModal, {
        open: true,
        connections,
        darkMode: false,
        onClose: vi.fn(),
        onInsert,
      }));
    });

    await act(async () => {
      (findButton(renderer!, 'conn-uuid-2') as { props: { onClick: () => void } }).props.onClick();
    });
    // 关闭只读开关
    const readonlySwitch = renderer!.root.findByProps({ 'data-testid': 'attach-readonly-switch' }) as unknown as {
      props: { onChange: (event: { target: { checked: boolean } }) => void };
    };
    await act(async () => {
      readonlySwitch.props.onChange({ target: { checked: false } });
    });
    // 自定义别名
    const aliasInput = renderer!.root.findByProps({ 'data-duckdb-attach-alias': 'true' }) as unknown as {
      props: { onChange: (event: { target: { value: string } }) => void };
    };
    await act(async () => {
      aliasInput.props.onChange({ target: { value: 'pg_main' } });
    });
    await clickInsert(renderer!);

    expect(onInsert).toHaveBeenCalledWith("ATTACH SAVED CONNECTION 'conn-uuid-2' AS pg_main READ WRITE");
  });
});
