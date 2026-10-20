import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DataGridErDiagram from './DataGridErDiagram';

const hookState = vi.hoisted(() => ({
  fitView: vi.fn(),
  latestReactFlowProps: null as { nodeTypes?: unknown } | null,
  graph: {
    nodes: [
      {
        id: 'er:messages',
        tableName: 'messages',
        role: 'current',
        isCurrent: true,
        incomingCount: 1,
        outgoingCount: 0,
        relationCount: 1,
        columns: Array.from({ length: 22 }, (_, index) => ({
          name: `field_${index + 1}`,
          type: 'varchar(32)',
          comment: '',
          nullable: index !== 0,
          isPrimary: index === 0,
          isForeign: false,
          isRelationField: index <= 1,
        })),
        previewColumnCount: 10,
        hiddenColumnCount: 12,
      },
      {
        id: 'er:message_tags',
        tableName: 'message_tags',
        role: 'incoming',
        isCurrent: false,
        incomingCount: 0,
        outgoingCount: 1,
        relationCount: 1,
        columns: [
          {
            name: 'id',
            type: 'bigint',
            comment: '',
            nullable: false,
            isPrimary: true,
            isForeign: false,
            isRelationField: true,
          },
          {
            name: 'message_id',
            type: 'bigint',
            comment: '',
            nullable: false,
            isPrimary: false,
            isForeign: true,
            isRelationField: true,
          },
        ],
        previewColumnCount: 2,
        hiddenColumnCount: 0,
      },
    ],
    edges: [],
    relationCount: 1,
    relatedTableCount: 1,
    incomingTableCount: 1,
    outgoingTableCount: 0,
    isEmpty: false,
  },
  loading: false,
  reloading: false,
  error: '',
  partial: false,
  reload: vi.fn(),
  canExpandRelations: true,
}));

vi.mock('./useDataGridErDiagram', () => ({
  useDataGridErDiagram: () => hookState,
}));

vi.mock('antd', () => ({
  Alert: ({ message }: { message?: React.ReactNode }) => <div>{message}</div>,
  Button: ({
    children,
    icon,
    onClick,
    disabled,
    ...props
  }: {
    children?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: (...args: any[]) => void;
    disabled?: boolean;
    [key: string]: any;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...props}>
      {icon}
      {children}
    </button>
  ),
  Spin: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@ant-design/icons', () => {
  const Icon = ({ label }: { label: string }) => <span>{label}</span>;
  return {
    ApartmentOutlined: () => <Icon label="ApartmentOutlined" />,
    ArrowRightOutlined: () => <Icon label="ArrowRightOutlined" />,
    CompressOutlined: () => <Icon label="CompressOutlined" />,
    DatabaseOutlined: () => <Icon label="DatabaseOutlined" />,
    ExpandOutlined: () => <Icon label="ExpandOutlined" />,
    LinkOutlined: () => <Icon label="LinkOutlined" />,
    PlusOutlined: () => <Icon label="PlusOutlined" />,
    ReloadOutlined: () => <Icon label="ReloadOutlined" />,
    UndoOutlined: () => <Icon label="UndoOutlined" />,
  };
});

vi.mock('reactflow', async () => {
  const ReactModule = await import('react');

  const ReactFlow = ({
    nodes,
    nodeTypes,
    children,
  }: {
    nodes: Array<{ id: string; type: string; data: any }>;
    nodeTypes: Record<string, React.ComponentType<any>>;
    children?: React.ReactNode;
  }) => {
    hookState.latestReactFlowProps = { nodeTypes };
    return (
    <div data-react-flow="true">
      {nodes.map((node) => {
        const NodeComponent = nodeTypes[node.type];
        return (
          <div key={node.id} data-node-id={node.id}>
            <NodeComponent data={node.data} />
          </div>
        );
      })}
      {children}
    </div>
  );
  };
  return {
    __esModule: true,
    default: ReactFlow,
    Background: () => null,
    Controls: () => null,
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => ({ fitView: hookState.fitView }),
    useNodesState: (initialNodes: any[]) => {
      const [nodes, setNodes] = ReactModule.useState(initialNodes);
      return [nodes, setNodes, vi.fn()] as const;
    },
    useEdgesState: (initialEdges: any[]) => {
      const [edges, setEdges] = ReactModule.useState(initialEdges);
      return [edges, setEdges, vi.fn()] as const;
    },
    BackgroundVariant: { Dots: 'dots' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    Position: { Left: 'left', Right: 'right' },
  };
});

const messages: Record<string, string> = {
  'data_grid.metadata_view.er_table_badge': '表',
  'data_grid.metadata_view.er_current_badge': '当前表',
  'data_grid.metadata_view.er_referenced_by_badge': '被引用',
  'data_grid.metadata_view.er_reference_badge': '引用',
  'data_grid.metadata_view.er_open_table': '打开表',
  'data_grid.metadata_view.er_related_table_count': '{{count}} 张关联表',
  'data_grid.metadata_view.er_relation_count': '{{count}} 条关系',
  'data_grid.metadata_view.er_relation_depth': '{{count}} 层关系',
  'data_grid.metadata_view.er_expand_relations': '展开下一层关系',
  'data_grid.metadata_view.er_reset_relations': '重置为一层',
  'data_grid.metadata_view.er_expand_fields': '展开全部字段',
  'data_grid.metadata_view.er_collapse_fields': '收起字段摘要',
  'data_grid.metadata_view.er_expand_hidden_columns': '展开剩余 {{count}} 个字段',
  'data_grid.metadata_view.er_empty': '当前表未发现外键关系',
  'data_grid.metadata_view.er_partial_warning': '部分关系未能完整加载，图中结果可能不完整',
  'data_grid.table_fallback.query_result': '查询结果',
  'common.refresh': '刷新',
};

const translate = (key: string, params?: Record<string, unknown>) => {
  let template = messages[key] || key;
  Object.entries(params || {}).forEach(([paramKey, paramValue]) => {
    template = template.replace(`{{${paramKey}}}`, String(paramValue));
  });
  return template;
};

const textContent = (node: any): string => {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => textContent(child)).join('');
  }
  if ('children' in node) {
    return textContent(node.children);
  }
  return '';
};

const findButton = (renderer: ReactTestRenderer, matcher: (node: any) => boolean) => (
  renderer.root.find((node) => node.type === 'button' && matcher(node))
);

describe('DataGridErDiagram', () => {
  beforeEach(() => {
    hookState.reload.mockReset();
    hookState.fitView.mockClear();
    hookState.canExpandRelations = true;
  });

  // 节点内字段列表是嵌套滚动容器：reactflow 只豁免 .nowheel 的滚轮事件，
  // 缺了它画布会把 wheel 抢去做缩放，节点内滚动条与滚轮全部失效。
  it('marks the node column list as nowheel so the canvas does not hijack scrolling', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <DataGridErDiagram
          connections={[]}
          connectionId="conn-1"
          dbName="main"
          tableName="messages"
          translate={translate}
        />,
      );
    });

    await act(async () => {
      findButton(renderer, (node) => node.props['data-er-node-toggle'] === 'er:messages').props.onClick({
        preventDefault() {},
        stopPropagation() {},
      });
    });

    const columnsHosts = renderer.root.findAll(
      (node) => typeof node.props.className === 'string' && node.props.className.includes('gn-er-node-columns'),
    );
    const scrollableHosts = columnsHosts.filter((node) => node.props.className.includes('is-scrollable'));
    expect(scrollableHosts).toHaveLength(1);
    expect(scrollableHosts[0].props.className).toContain('nowheel');
    // 未进入可滚动状态的列区不应带 nowheel：滚轮仍交给画布做缩放。
    expect(
      columnsHosts
        .filter((node) => !node.props.className.includes('is-scrollable'))
        .every((node) => !node.props.className.includes('nowheel')),
    ).toBe(true);
  });

  // 展开/收起只改变节点内部高度，不应触发全图 fitView：
  // 全图重排 + 动画会让点击目标移位（点击丢失）并把整张图缩得很小。
  it('does not refit the whole graph when a node toggles its fields', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <DataGridErDiagram
          connections={[]}
          connectionId="conn-1"
          dbName="main"
          tableName="messages"
          translate={translate}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const baseline = hookState.fitView.mock.calls.length;
    expect(baseline).toBeGreaterThan(0);

    await act(async () => {
      findButton(renderer, (node) => node.props['data-er-node-toggle'] === 'er:messages').props.onClick({
        preventDefault() {},
        stopPropagation() {},
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(hookState.fitView.mock.calls.length).toBe(baseline);
  });

  // 展开/收起时其余节点的 data 引用必须保持稳定：data 每次重建会让
  // ErTableNode 的 memo 失效，大图上所有节点整体重渲染造成明显卡顿。
  it('keeps untouched node data identities stable across an expand toggle', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <DataGridErDiagram
          connections={[]}
          connectionId="conn-1"
          dbName="main"
          tableName="messages"
          translate={translate}
        />,
      );
    });

    const findNodeData = (tableName: string) =>
      renderer.root.findAll((node) => node.props?.data?.node?.tableName === tableName)[0]?.props.data;
    const untouchedBefore = findNodeData('message_tags');
    expect(untouchedBefore).toBeTruthy();

    await act(async () => {
      findButton(renderer, (node) => node.props['data-er-node-toggle'] === 'er:messages').props.onClick({
        preventDefault() {},
        stopPropagation() {},
      });
    });

    const untouchedAfter = findNodeData('message_tags');
    expect(untouchedAfter).toBe(untouchedBefore);
  });

  // reactflow error #002：nodeTypes 引用跨渲染变化会全量重挂载节点 DOM，
  // 滚动位置与点击上下文都会丢失。引用必须跨渲染保持稳定。
  it('keeps the nodeTypes identity stable across an expand toggle', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <DataGridErDiagram
          connections={[]}
          connectionId="conn-1"
          dbName="main"
          tableName="messages"
          translate={translate}
        />,
      );
    });
    const before = hookState.latestReactFlowProps?.nodeTypes;
    expect(before).toBeTruthy();

    await act(async () => {
      findButton(renderer, (node) => node.props['data-er-node-toggle'] === 'er:messages').props.onClick({
        preventDefault() {},
        stopPropagation() {},
      });
    });

    expect(hookState.latestReactFlowProps?.nodeTypes).toBe(before);
  });

  it('shows hidden fields on demand and lets the toolbar collapse them again', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <DataGridErDiagram
          connections={[]}
          connectionId="conn-1"
          dbName="main"
          tableName="messages"
          translate={translate}
        />,
      );
    });

    expect(textContent(renderer.toJSON())).not.toContain('field_11');
    expect(
      findButton(renderer, (node) => node.props['data-er-node-toggle'] === 'er:messages').props.className,
    ).toContain('nodrag');

    await act(async () => {
      findButton(renderer, (node) => node.props['data-er-node-toggle'] === 'er:messages').props.onClick({
        preventDefault() {},
        stopPropagation() {},
      });
    });

    expect(textContent(renderer.toJSON())).toContain('field_11');
    expect(textContent(renderer.toJSON())).toContain('收起字段摘要');

    await act(async () => {
      findButton(renderer, (node) => node.props['data-er-action'] === 'collapse-fields').props.onClick();
    });

    expect(textContent(renderer.toJSON())).not.toContain('field_11');
  });

  it('tracks relation depth from the toolbar controls', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <DataGridErDiagram
          connections={[]}
          connectionId="conn-1"
          dbName="main"
          tableName="messages"
          translate={translate}
        />,
      );
    });

    expect(textContent(renderer.toJSON())).toContain('1 层关系');

    await act(async () => {
      findButton(renderer, (node) => node.props['data-er-action'] === 'expand-relations').props.onClick();
    });

    expect(textContent(renderer.toJSON())).toContain('2 层关系');

    await act(async () => {
      findButton(renderer, (node) => node.props['data-er-action'] === 'reset-relations').props.onClick();
    });

    expect(textContent(renderer.toJSON())).toContain('1 层关系');
  });
});
