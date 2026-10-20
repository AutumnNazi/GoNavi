import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Spin, Tooltip } from 'antd';
import {
  ApartmentOutlined,
  ArrowRightOutlined,
  CompressOutlined,
  DatabaseOutlined,
  ExpandOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import dagre from 'dagre';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { t as defaultTranslate, type I18nParams } from '../i18n';
import type { BuildErDiagramGraphResult, ErDiagramEdge, ErDiagramNode } from './dataGridErDiagramModel';
import { useDataGridErDiagram } from './useDataGridErDiagram';

type DataGridMetadataTranslate = (key: string, params?: I18nParams) => string;

export interface DataGridErDiagramProps {
  connections: any[];
  connectionId?: string;
  dbName?: string;
  tableName?: string;
  translate?: DataGridMetadataTranslate;
  onOpenTable?: (tableName: string) => void;
}

type ErDiagramNodeData = {
  node: ErDiagramNode;
  selected: boolean;
  expanded: boolean;
  translate: DataGridMetadataTranslate;
  onToggleExpanded?: (nodeId: string) => void;
  onOpenTable?: (tableName: string) => void;
};

const NODE_WIDTH = 320;
const NODE_BASE_HEIGHT = 108;
const NODE_ROW_HEIGHT = 28;
const NODE_FOOTER_HEIGHT = 36;
const NODE_EXPANDED_MAX_VISIBLE_ROWS = 14;

const getRoleBadgeKey = (role: ErDiagramNode['role']): string => {
  switch (role) {
    case 'current':
      return 'data_grid.metadata_view.er_current_badge';
    case 'incoming':
      return 'data_grid.metadata_view.er_referenced_by_badge';
    case 'outgoing':
      return 'data_grid.metadata_view.er_reference_badge';
    default:
      return 'data_grid.metadata_view.er_table_badge';
  }
};

const getVisibleNodeColumns = (node: ErDiagramNode, expanded: boolean) => (
  expanded ? node.columns : node.columns.slice(0, node.previewColumnCount)
);

const getVisibleNodeRowCount = (node: ErDiagramNode, expanded: boolean): number => Math.min(
  getVisibleNodeColumns(node, expanded).length,
  expanded ? NODE_EXPANDED_MAX_VISIBLE_ROWS : node.previewColumnCount,
);

const getNodeColumnViewportHeight = (node: ErDiagramNode, expanded: boolean): number => (
  getVisibleNodeRowCount(node, expanded) * NODE_ROW_HEIGHT
);

const estimateNodeHeight = (node: ErDiagramNode, expanded: boolean): number => (
  NODE_BASE_HEIGHT +
  getNodeColumnViewportHeight(node, expanded) +
  (node.hiddenColumnCount > 0 ? NODE_FOOTER_HEIGHT : 0)
);

const edgeColorByDirection: Record<ErDiagramEdge['direction'], string> = {
  incoming: '#2f9e44',
  outgoing: '#1971c2',
  self: '#7c3aed',
};

const layoutGraph = (
  graph: BuildErDiagramGraphResult,
  translate: DataGridMetadataTranslate,
  expandedNodeIds: Set<string>,
  onToggleExpanded?: (nodeId: string) => void,
  onOpenTable?: (tableName: string) => void,
): { nodes: Node<ErDiagramNodeData>[]; edges: Edge[] } => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setGraph({
    rankdir: 'LR',
    nodesep: 56,
    ranksep: 96,
    marginx: 24,
    marginy: 24,
  });
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  graph.nodes.forEach((node) => {
    const expanded = expandedNodeIds.has(node.id);
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: estimateNodeHeight(node, expanded),
    });
  });
  graph.edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });
  dagre.layout(dagreGraph);

  return {
    nodes: graph.nodes.map((node) => {
      const expanded = expandedNodeIds.has(node.id);
      const height = estimateNodeHeight(node, expanded);
      const position = dagreGraph.node(node.id);
      return {
        id: node.id,
        type: 'erTable',
        position: {
          x: (position?.x ?? NODE_WIDTH / 2) - (NODE_WIDTH / 2),
          y: (position?.y ?? height / 2) - (height / 2),
        },
        data: {
          node,
          selected: false,
          expanded,
          translate,
          onToggleExpanded,
          onOpenTable,
        },
        draggable: true,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
    }),
    edges: graph.edges.map((edge) => {
      const color = edgeColorByDirection[edge.direction];
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: 'smoothstep',
        animated: edge.direction === 'self',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color,
        },
        style: {
          stroke: color,
          strokeWidth: edge.direction === 'self' ? 2 : 1.7,
        },
        labelStyle: {
          fill: 'var(--gn-fg-4)',
          fontSize: 11,
          fontWeight: 600,
        },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 4,
        labelBgStyle: {
          fill: 'var(--gn-bg-panel-2)',
          stroke: 'var(--gn-br-1)',
        },
      };
    }),
  };
};

const ErTableNode = memo(function ErTableNode({ data }: { data: ErDiagramNodeData }) {
  const { node, selected, expanded, translate, onToggleExpanded, onOpenTable } = data;
  const roleBadgeKey = getRoleBadgeKey(node.role);
  const canOpen = !node.isCurrent && typeof onOpenTable === 'function';
  const visibleColumns = getVisibleNodeColumns(node, expanded);
  const footerLabel = expanded
    ? translate('data_grid.metadata_view.er_collapse_fields')
    : translate('data_grid.metadata_view.er_expand_hidden_columns', { count: node.hiddenColumnCount });
  const columnsScrollable = expanded && visibleColumns.length > NODE_EXPANDED_MAX_VISIBLE_ROWS;

  return (
    <div
      className={`gn-er-node-card${selected ? ' is-selected' : ''}${node.isCurrent ? ' is-current' : ''}`}
      data-role={node.role}
      data-er-node-table={node.tableName}
    >
      <div className="gn-er-node-header">
        <div className="gn-er-node-title">
          <span className="gn-er-node-badge">{translate(roleBadgeKey)}</span>
          <strong title={node.tableName}>{node.tableName}</strong>
        </div>
        {canOpen && (
          <Tooltip title={translate('data_grid.metadata_view.er_open_table')}>
            <Button
              size="small"
              type="text"
              className="gn-er-node-open nodrag nopan"
              icon={<ArrowRightOutlined />}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenTable?.(node.tableName);
              }}
            />
          </Tooltip>
        )}
      </div>

      <div className="gn-er-node-stats">
        <Tooltip title={translate('data_grid.metadata_view.er_referenced_by_badge')}>
          <span>
            <ApartmentOutlined />
            {node.incomingCount}
          </span>
        </Tooltip>
        <Tooltip title={translate('data_grid.metadata_view.er_reference_badge')}>
          <span>
            <LinkOutlined />
            {node.outgoingCount}
          </span>
        </Tooltip>
      </div>

      <div
        className={`gn-er-node-columns nodrag nopan${columnsScrollable ? ' is-scrollable nowheel' : ''}`}
        style={{ '--er-node-columns-max-height': `${getNodeColumnViewportHeight(node, expanded)}px` } as React.CSSProperties}
      >
        {visibleColumns.map((column) => (
          <div
            key={column.name}
            className={`gn-er-node-column${column.isRelationField ? ' is-relation' : ''}`}
            data-er-node-column={column.name}
          >
            <div className="gn-er-node-column-name">
              {column.isPrimary && <em className="is-pk">PK</em>}
              {!column.isPrimary && column.isForeign && <em className="is-fk">FK</em>}
              <code title={column.comment || column.name}>{column.name}</code>
            </div>
            <span className="gn-er-node-column-type">{column.type || '-'}</span>
          </div>
        ))}
      </div>

      {node.hiddenColumnCount > 0 && (
        <div className="gn-er-node-footer">
          <button
            type="button"
            className="gn-er-node-footer-toggle nodrag nopan"
            data-er-node-toggle={node.id}
            title={footerLabel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleExpanded?.(node.id);
            }}
          >
            {footerLabel}
          </button>
        </div>
      )}
    </div>
  );
});

// reactflow 要求 nodeTypes 引用稳定：内联字面量每次渲染都是新对象，会触发
// error #002 并全量重挂载节点 DOM（滚动位置丢失、点击被吞）。
const erNodeTypes = { erTable: ErTableNode };

const DataGridErDiagramCanvasInner: React.FC<{
  graph: BuildErDiagramGraphResult;
  translate: DataGridMetadataTranslate;
  expandedNodeIds: Set<string>;
  onToggleNodeExpanded: (nodeId: string) => void;
  onOpenTable?: (tableName: string) => void;
}> = ({
  graph,
  translate,
  expandedNodeIds,
  onToggleNodeExpanded,
  onOpenTable,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(graph.nodes[0]?.id || null);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setSelectedNodeId(graph.nodes[0]?.id || null);
  }, [graph.nodes]);

  const layout = useMemo(
    () => layoutGraph(graph, translate, expandedNodeIds, onToggleNodeExpanded, onOpenTable),
    [expandedNodeIds, graph, onOpenTable, onToggleNodeExpanded, translate],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  // 节点 data 按 id 缓存：只有业务字段真变化的节点才换 data 引用，
  // 其余节点靠 ErTableNode 的 memo 跳过重渲染（大图展开时的卡顿主因）。
  const nodeDataCacheRef = useRef(new Map<string, ErDiagramNodeData>());
  const buildNodeData = useCallback((node: ErDiagramNode, expanded: boolean, selected: boolean): ErDiagramNodeData => {
    const next: ErDiagramNodeData = {
      node,
      selected,
      expanded,
      translate,
      onToggleExpanded: onToggleNodeExpanded,
      onOpenTable,
    };
    const cached = nodeDataCacheRef.current.get(node.id);
    if (
      cached
      && cached.node === next.node
      && cached.selected === next.selected
      && cached.expanded === next.expanded
      && cached.translate === next.translate
      && cached.onToggleExpanded === next.onToggleExpanded
      && cached.onOpenTable === next.onOpenTable
    ) {
      return cached;
    }
    nodeDataCacheRef.current.set(node.id, next);
    return next;
  }, [onOpenTable, onToggleNodeExpanded, translate]);

  // 清理已不存在的节点缓存，避免长会话中切表累积。
  useEffect(() => {
    nodeDataCacheRef.current = new Map(
      Array.from(nodeDataCacheRef.current.entries()).filter(([nodeId]) => graph.nodes.some((node) => node.id === nodeId)),
    );
  }, [graph]);

  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const prevLayoutNodesRef = useRef(layout.nodes);

  // 布局变化（dagre 重排）与选中/展开变化走不同路径：
  // 前者灌入 dagre 新位置并按 layout 重建；后者基于现有节点只改 data 与
  // selected——保留用户拖动过的位置，不把节点拉回布局坐标。
  // 两条路径都经 buildNodeData 复用 data 引用，未变化的节点不触发重渲染。
  useEffect(() => {
    const layoutChanged = prevLayoutNodesRef.current !== layout.nodes;
    prevLayoutNodesRef.current = layout.nodes;
    setNodes((currentNodes) => {
      if (layoutChanged) {
        return layout.nodes.map((layoutNode) => {
          const selected = layoutNode.id === selectedNodeIdRef.current;
          return {
            ...layoutNode,
            selected,
            data: buildNodeData(layoutNode.data.node, expandedNodeIds.has(layoutNode.id), selected),
          };
        });
      }
      return currentNodes.map((node) => {
        const selected = node.id === selectedNodeId;
        const nextData = buildNodeData(node.data.node, expandedNodeIds.has(node.id), selected);
        if (node.data === nextData && node.selected === selected) {
          return node;
        }
        return { ...node, selected, data: nextData };
      });
    });
  }, [buildNodeData, expandedNodeIds, layout.nodes, selectedNodeId, setNodes]);

  useEffect(() => {
    setEdges(layout.edges);
  }, [layout.edges, setEdges]);

  // 仅在图数据变化（切表/刷新/加深关系）时重取全景；展开/收起只改变节点
  // 内部高度，此时全图 fitView 会把视野拉远并让点击目标漂移。
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      void fitView({ padding: 0.18, duration: 220 });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [fitView, graph]);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const handleNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    const nodeData = node.data as ErDiagramNodeData | undefined;
    if (nodeData?.node?.isCurrent) {
      return;
    }
    nodeData?.onOpenTable?.(nodeData.node.tableName);
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={erNodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onNodeDoubleClick={handleNodeDoubleClick}
      onPaneClick={() => setSelectedNodeId(null)}
      minZoom={0.35}
      maxZoom={1.8}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
};

const DataGridErDiagramCanvas: React.FC<{
  graph: BuildErDiagramGraphResult;
  translate: DataGridMetadataTranslate;
  expandedNodeIds: Set<string>;
  onToggleNodeExpanded: (nodeId: string) => void;
  onOpenTable?: (tableName: string) => void;
}> = (props) => (
  <ReactFlowProvider>
    <DataGridErDiagramCanvasInner {...props} />
  </ReactFlowProvider>
);

const DataGridErDiagram: React.FC<DataGridErDiagramProps> = ({
  connections,
  connectionId,
  dbName,
  tableName,
  translate = defaultTranslate,
  onOpenTable,
}) => {
  const [relationDepth, setRelationDepth] = useState(1);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const {
    graph,
    loading,
    reloading,
    error,
    partial,
    reload,
    canExpandRelations,
  } = useDataGridErDiagram({
    connections,
    connectionId,
    dbName,
    tableName,
    relationDepth,
  });

  useEffect(() => {
    setRelationDepth(1);
    setExpandedNodeIds(new Set());
  }, [connectionId, dbName, tableName]);

  const expandableNodeIds = useMemo(
    () => graph?.nodes.filter((node) => node.hiddenColumnCount > 0).map((node) => node.id) || [],
    [graph],
  );

  useEffect(() => {
    const nextExpandableIds = new Set(expandableNodeIds);
    setExpandedNodeIds((current) => new Set(Array.from(current).filter((nodeId) => nextExpandableIds.has(nodeId))));
  }, [expandableNodeIds]);

  const expandedFieldCount = useMemo(
    () => expandableNodeIds.filter((nodeId) => expandedNodeIds.has(nodeId)).length,
    [expandableNodeIds, expandedNodeIds],
  );
  const allFieldsExpanded = expandableNodeIds.length > 0 && expandedFieldCount === expandableNodeIds.length;

  const handleToggleNodeExpanded = useCallback((nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleExpandAllFields = useCallback(() => {
    setExpandedNodeIds(new Set(expandableNodeIds));
  }, [expandableNodeIds]);

  const handleCollapseAllFields = useCallback(() => {
    setExpandedNodeIds(new Set());
  }, []);

  const handleExpandRelations = useCallback(() => {
    setRelationDepth((currentDepth) => currentDepth + 1);
  }, []);

  const handleResetRelationDepth = useCallback(() => {
    setRelationDepth(1);
  }, []);

  return (
    <div className="gn-v2-data-grid-er-diagram">
      <div className="gn-v2-data-grid-er-toolbar">
        <div>
          <span>{translate('data_grid.metadata_view.er_table_badge')}</span>
          <strong>{tableName || translate('data_grid.table_fallback.query_result')}</strong>
        </div>
        <div>
          <div className="gn-v2-data-grid-er-summary">
            <span className="gn-v2-data-grid-er-chip">
              <DatabaseOutlined />
              {translate('data_grid.metadata_view.er_related_table_count', { count: graph?.relatedTableCount ?? 0 })}
            </span>
            <span className="gn-v2-data-grid-er-chip">
              <ApartmentOutlined />
              {translate('data_grid.metadata_view.er_relation_count', { count: graph?.relationCount ?? 0 })}
            </span>
            <span className="gn-v2-data-grid-er-chip">
              <LinkOutlined />
              {translate('data_grid.metadata_view.er_relation_depth', { count: relationDepth })}
            </span>
          </div>
          <div className="gn-v2-data-grid-er-actions">
            <Button
              size="small"
              icon={<PlusOutlined />}
              data-er-action="expand-relations"
              onClick={handleExpandRelations}
              disabled={!graph || loading || reloading || !canExpandRelations}
            >
              {translate('data_grid.metadata_view.er_expand_relations')}
            </Button>
            <Button
              size="small"
              icon={<UndoOutlined />}
              data-er-action="reset-relations"
              onClick={handleResetRelationDepth}
              disabled={relationDepth <= 1}
            >
              {translate('data_grid.metadata_view.er_reset_relations')}
            </Button>
            <Button
              size="small"
              icon={<ExpandOutlined />}
              data-er-action="expand-fields"
              onClick={handleExpandAllFields}
              disabled={expandableNodeIds.length === 0 || allFieldsExpanded}
            >
              {translate('data_grid.metadata_view.er_expand_fields')}
            </Button>
            <Button
              size="small"
              icon={<CompressOutlined />}
              data-er-action="collapse-fields"
              onClick={handleCollapseAllFields}
              disabled={expandedFieldCount === 0}
            >
              {translate('data_grid.metadata_view.er_collapse_fields')}
            </Button>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              data-er-action="refresh"
              onClick={reload}
              loading={reloading}
            >
              {translate('common.refresh')}
            </Button>
          </div>
        </div>
      </div>

      {partial && !error && (
        <div className="gn-v2-data-grid-er-alert">
          <Alert
            type="warning"
            showIcon
            message={translate('data_grid.metadata_view.er_partial_warning')}
          />
        </div>
      )}

      {error ? (
        <div className="gn-v2-data-grid-er-alert">
          <Alert type="error" showIcon message={error} />
        </div>
      ) : null}

      <div className="gn-v2-data-grid-er-canvas">
        <Spin spinning={loading || reloading}>
          {graph ? (
            <>
              {graph.isEmpty && (
                <div className="gn-v2-data-grid-er-empty">
                  {translate('data_grid.metadata_view.er_empty')}
                </div>
              )}
              <DataGridErDiagramCanvas
                graph={graph}
                translate={translate}
                expandedNodeIds={expandedNodeIds}
                onToggleNodeExpanded={handleToggleNodeExpanded}
                onOpenTable={onOpenTable}
              />
            </>
          ) : (
            <div className="gn-v2-data-grid-er-placeholder" />
          )}
        </Spin>
      </div>
    </div>
  );
};

export default DataGridErDiagram;
