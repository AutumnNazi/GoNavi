import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import NacosServiceTable, { type NacosServiceRow } from './NacosServiceTable';

const antdState = vi.hoisted(() => ({
  tableProps: [] as any[],
}));

// antd's Table reaches for findDOMNode via rc-resize-observer, which needs a real DOM
// that react-test-renderer does not provide. Capture the props instead — the column
// renders are what this suite is about, not antd's own layout.
vi.mock('@ant-design/icons', async () => {
  const ReactModule = await import('react');
  const Icon = () => ReactModule.createElement('span', { 'data-icon': true });
  return { DeleteOutlined: Icon };
});

vi.mock('antd', async () => {
  const ReactModule = await import('react');
  return {
    Button: ({ children, ...props }: any) => ReactModule.createElement('button', props, children),
    Popconfirm: ({ children, ...props }: any) =>
      ReactModule.createElement('popconfirm', props, children),
    Table: (props: any) => {
      antdState.tableProps.push(props);
      return ReactModule.createElement('nacos-table');
    },
  };
});

const tr = (key: string) => key;

const rows: NacosServiceRow[] = [
  { rawName: 'GROUP_A@@alpha', serviceName: 'alpha', groupName: 'GROUP_A' },
  { rawName: 'GROUP_A@@beta', serviceName: 'beta', groupName: 'GROUP_A' },
];

const renderTable = (over: Partial<React.ComponentProps<typeof NacosServiceTable>> = {}) => {
  antdState.tableProps = [];
  create(
    <NacosServiceTable
      rows={rows}
      statistics={new Map()}
      loading={false}
      selectedRaw={null}
      structureRestricted={false}
      mutedColor="#888"
      tr={tr}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      {...over}
    />,
  );
};

const latestTableProps = (): any => antdState.tableProps[antdState.tableProps.length - 1];

const columnsOf = () => latestTableProps().columns as Array<{ key: string; render?: Function }>;

const cellFor = (columnKey: string, row: NacosServiceRow) => {
  const column = columnsOf().find((item) => item.key === columnKey);
  if (!column?.render) throw new Error(`no renderable column ${columnKey}`);
  return column.render(undefined, row, 0);
};

describe('NacosServiceTable', () => {
  it('renders a health badge for every row whose statistics were reported', () => {
    const statistics = new Map([
      ['GROUP_A@@alpha', {
        name: 'alpha', groupName: 'GROUP_A',
        instanceCount: 3, healthyInstanceCount: 3, statisticsAvailable: true,
      }],
      ['GROUP_A@@beta', {
        name: 'beta', groupName: 'GROUP_A',
        instanceCount: 3, healthyInstanceCount: 0, statisticsAvailable: true,
      }],
    ]);
    renderTable({ statistics });

    expect(cellFor('health', rows[0]).props.summary).toMatchObject({ healthyInstanceCount: 3 });
    expect(cellFor('health', rows[1]).props.summary).toMatchObject({ healthyInstanceCount: 0 });
  });

  it('leaves the health cell empty when the group reported no statistics', () => {
    renderTable({ statistics: new Map() });

    // No summary for the row -> the badge renders nothing rather than "0/0 down".
    expect(cellFor('health', rows[0]).props.summary).toBeUndefined();
  });

  it('keeps the health cell out of the ellipsis-clipped name cell', () => {
    // The service name cell is `ellipsis`, so a badge appended to it would be
    // clipped for long names. It must be a column of its own.
    renderTable();
    const keys = columnsOf().map((column) => column.key);

    expect(keys).toContain('health');
    expect(keys.indexOf('health')).toBeGreaterThan(keys.indexOf('serviceName'));
  });

  it('routes row clicks through the injected onSelect callback', () => {
    const onSelect = vi.fn();
    renderTable({ onSelect });

    latestTableProps().onRow(rows[0]).onClick();
    expect(onSelect).toHaveBeenCalledWith('GROUP_A@@alpha');
  });

  it('marks only the selected row as selected', () => {
    renderTable({ selectedRaw: 'GROUP_A@@beta' });
    const rowClassName = latestTableProps().rowClassName as (row: NacosServiceRow) => string;

    expect(rowClassName(rows[0])).toBe('');
    expect(rowClassName(rows[1])).toBe('ant-table-row-selected');
  });
});
