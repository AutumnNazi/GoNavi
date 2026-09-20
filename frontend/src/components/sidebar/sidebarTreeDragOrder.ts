import {
  isConnectionTagDescendant,
  resolveSidebarHostGroupDropDestination,
  resolveSidebarDropDomHit,
  resolveSidebarDropInsertBefore,
  resolveSidebarTreeDropPlacement,
  type SidebarTreeDropPlacement,
  type SidebarTreeNode,
} from '../sidebarV2Utils';
import { isV2SidebarObjectNode, resolveSidebarObjectDragText } from '../sidebarCoreUtils';
import { buildSidebarRootConnectionToken, buildSidebarRootTagToken } from '../../store';
import type { ConnectionTag } from '../../types';
import { SIDEBAR_SQL_EDITOR_DRAG_MIME, encodeSidebarSqlEditorDragPayload } from '../../utils/sidebarSqlDrag';
import type { SidebarTableSortPreference, SidebarTreeOrders } from '../../utils/sidebarTreeOrder';

type SidebarTreeNodeParent = {
  parentKey: string;
  siblings: SidebarTreeNode[];
};

export type SidebarTreeOrderDropResult = {
  parentKey: string;
  orderedKeys: string[];
  treeData: SidebarTreeNode[];
};

type SidebarTreeOrderCommitCallbacks = {
  onTreeData: (treeData: SidebarTreeNode[]) => void;
  onTreeOrders: (parentKey: string, orderedKeys: string[], nextOrders: SidebarTreeOrders) => void;
  onTableSort: (
    connectionId: string,
    dbName: string,
    nextPreferences: Record<string, SidebarTableSortPreference>,
  ) => void;
};

type SidebarTreeDragEventLike = {
  clientX?: number;
  clientY?: number;
  dataTransfer?: DataTransfer | null;
  target?: EventTarget | null;
};

type SidebarTreeMouseDownEventLike = {
  nativeEvent?: Event & { _virtualHandled?: boolean };
  target?: EventTarget | null;
};

export const isSidebarTreeOrderNode = (
  node: Pick<SidebarTreeNode, 'type'> | null | undefined,
): node is SidebarTreeNode => (
  node?.type === 'database' || node?.type === 'saved-query' || isV2SidebarObjectNode(node)
);

export const isSidebarHostTreeNode = (
  node: Pick<SidebarTreeNode, 'type'> | null | undefined,
): node is SidebarTreeNode & { type: 'connection' | 'tag' } => (
  node?.type === 'connection' || node?.type === 'tag'
);

export const markSidebarTreeMouseDownHandled = (
  event: SidebarTreeMouseDownEventLike,
): boolean => {
  const target = event.target as Element | null;
  if (
    !event.nativeEvent
    || typeof target?.closest !== 'function'
    || !target.closest('.ant-tree-treenode-draggable')
  ) {
    return false;
  }
  event.nativeEvent._virtualHandled = true;
  return true;
};

export const setSidebarTreeSqlDragData = (
  event: SidebarTreeDragEventLike,
  node: SidebarTreeNode,
): boolean => {
  const dragText = resolveSidebarObjectDragText(node);
  if (!dragText || !event.dataTransfer) return false;
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData('text/plain', dragText);
  event.dataTransfer.setData(
    SIDEBAR_SQL_EDITOR_DRAG_MIME,
    encodeSidebarSqlEditorDragPayload({
      text: dragText,
      nodeType: node.type,
      connectionId: String(node.dataRef?.id || ''),
      dbName: String(node.dataRef?.dbName || ''),
    }),
  );
  return true;
};

export const getSidebarTreeTagParentId = (
  connectionTags: ConnectionTag[],
  tagId: unknown,
): string | null => {
  const tag = connectionTags.find((candidate) => candidate.id === String(tagId || '').trim());
  return String(tag?.parentTagId || '').trim() || null;
};

export const getSidebarTreeNodeParentTagId = (
  node: SidebarTreeNode | null | undefined,
  connectionTags: ConnectionTag[],
): string | null => {
  if (node?.type === 'tag') return getSidebarTreeTagParentId(connectionTags, node.dataRef?.id);
  if (node?.type !== 'connection') return null;
  return connectionTags.find((tag) => tag.connectionIds.includes(String(node.key || '').trim()))?.id || null;
};

export const getSidebarTreeNodeOrderToken = (
  node: SidebarTreeNode | null | undefined,
): string | null => {
  if (node?.type === 'tag') {
    const tagId = String(node.dataRef?.id || '').trim();
    return tagId ? buildSidebarRootTagToken(tagId) : null;
  }
  if (node?.type === 'connection') {
    const connectionId = String(node.key || '').trim();
    return connectionId ? buildSidebarRootConnectionToken(connectionId) : null;
  }
  return null;
};

export const resolveSidebarHostTreeGapTarget = (
  treeData: SidebarTreeNode[],
  dropNode: SidebarTreeNode,
  placement: SidebarTreeDropPlacement,
) => {
  if (placement !== 'before') return { dropNode, placement };
  const parent = findSidebarTreeNodeParent(treeData, String(dropNode.key));
  const dropIndex = parent?.siblings.findIndex(
    (node) => String(node.key) === String(dropNode.key),
  ) ?? -1;
  for (let index = dropIndex - 1; index >= 0; index -= 1) {
    const candidate = parent?.siblings[index];
    if (!isSidebarHostTreeNode(candidate)) continue;
    return { dropNode: candidate, placement: 'after' as const };
  }
  return { dropNode, placement };
};

const findSidebarTreeNodeParent = (
  nodes: SidebarTreeNode[],
  targetKey: string,
  parentKey = '',
): SidebarTreeNodeParent | null => {
  if (nodes.some((node) => String(node.key) === targetKey)) {
    return { parentKey, siblings: nodes };
  }
  for (const node of nodes) {
    if (!node.children?.length) continue;
    const match = findSidebarTreeNodeParent(node.children, targetKey, String(node.key));
    if (match) return match;
  }
  return null;
};

export const isSidebarTreeGapNoOp = (
  treeData: SidebarTreeNode[],
  source: SidebarTreeNode,
  target: SidebarTreeNode,
  placement: 'before' | 'after',
): boolean => {
  const sourceParent = findSidebarTreeNodeParent(treeData, String(source.key));
  const targetParent = findSidebarTreeNodeParent(treeData, String(target.key));
  if (!sourceParent || !targetParent || sourceParent.parentKey !== targetParent.parentKey) return false;
  const sourceIndex = sourceParent.siblings.findIndex((node) => String(node.key) === String(source.key));
  const targetIndex = targetParent.siblings.findIndex((node) => String(node.key) === String(target.key));
  if (sourceIndex < 0 || targetIndex < 0) return false;
  return placement === 'before'
    ? targetIndex === sourceIndex || targetIndex === sourceIndex + 1
    : targetIndex === sourceIndex || targetIndex === sourceIndex - 1;
};

const isSameSidebarTreePinSection = (
  source: SidebarTreeNode,
  target: SidebarTreeNode,
): boolean => {
  if (source.type === 'database') {
    return Boolean(source.dataRef?.pinnedSidebarDatabase)
      === Boolean(target.dataRef?.pinnedSidebarDatabase);
  }
  return source.type !== 'table' || Boolean(source.dataRef?.pinnedSidebarTable)
    === Boolean(target.dataRef?.pinnedSidebarTable);
};

export const canDropSidebarTreeOrderNode = (
  treeData: SidebarTreeNode[],
  source: SidebarTreeNode | null | undefined,
  target: SidebarTreeNode | null | undefined,
  relativeDropPosition: number,
): boolean => {
  if (!isSidebarTreeOrderNode(source) || !isSidebarTreeOrderNode(target)) return false;
  if (source.type !== target.type || String(source.key) === String(target.key)) return false;
  if (relativeDropPosition === 0 || !isSameSidebarTreePinSection(source, target)) return false;
  const sourceParent = findSidebarTreeNodeParent(treeData, String(source.key));
  const targetParent = findSidebarTreeNodeParent(treeData, String(target.key));
  return Boolean(
    sourceParent
    && targetParent
    && sourceParent.parentKey === targetParent.parentKey
    && !isSidebarTreeGapNoOp(
      treeData,
      source,
      target,
      relativeDropPosition < 0 ? 'before' : 'after',
    )
  );
};

const findSidebarTreeNode = (
  nodes: SidebarTreeNode[],
  targetKey: string,
): SidebarTreeNode | null => {
  for (const node of nodes) {
    if (String(node.key) === targetKey) return node;
    if (node.children?.length) {
      const match = findSidebarTreeNode(node.children, targetKey);
      if (match) return match;
    }
  }
  return null;
};

export const resolveSidebarHostTreeDropAtEvent = (
  treeData: SidebarTreeNode[],
  dragNode: SidebarTreeNode | null | undefined,
  event: SidebarTreeDragEventLike,
) => {
  if (!isSidebarHostTreeNode(dragNode)) return null;
  const hit = resolveSidebarDropDomHit(event);
  if (!hit?.metrics) return null;
  const hoveredNode = findSidebarTreeNode(treeData, hit.key);
  if (!isSidebarHostTreeNode(hoveredNode)) return null;
  const placement = resolveSidebarTreeDropPlacement({
    dragNodeType: dragNode.type,
    dropNodeType: hoveredNode.type,
    relativeDropPosition: 0,
    dropToGap: undefined,
    fallbackInsertBefore: resolveSidebarDropInsertBefore(0, {
      clientY: event.clientY,
      top: hit.metrics.top,
      height: hit.metrics.height,
    }),
    metrics: {
      clientY: event.clientY,
      top: hit.metrics.top,
      height: hit.metrics.height,
    },
  });
  const target = resolveSidebarHostTreeGapTarget(treeData, hoveredNode, placement);
  if (String(target.dropNode.key) === String(dragNode.key)) return null;
  if (
    target.placement !== 'inside'
    && isSidebarTreeGapNoOp(treeData, dragNode, target.dropNode, target.placement)
  ) return null;
  return {
    dragNode,
    dropNode: target.dropNode,
    hit: target.dropNode === hoveredNode
      ? hit
      : { ...hit, key: String(target.dropNode.key), type: String(target.dropNode.type) },
    placement: target.placement,
  };
};

export const resolveSidebarHostTreeMove = (options: {
  dragNode: SidebarTreeNode;
  dropNode: SidebarTreeNode;
  placement: SidebarTreeDropPlacement;
  connectionTags: ConnectionTag[];
}) => {
  if (!isSidebarHostTreeNode(options.dragNode) || !isSidebarHostTreeNode(options.dropNode)) return null;
  if (options.placement === 'inside' && options.dropNode.type !== 'tag') return null;
  const targetTagId = options.dropNode.type === 'tag'
    ? String(options.dropNode.dataRef?.id || '').trim()
    : '';
  const destination = resolveSidebarHostGroupDropDestination({
    targetTagId,
    targetTagParentId: getSidebarTreeNodeParentTagId(options.dropNode, options.connectionTags),
    targetTagToken: getSidebarTreeNodeOrderToken(options.dropNode),
    placement: options.placement,
  });
  if (options.dragNode.type === 'tag') {
    const id = String(options.dragNode.dataRef?.id || '').trim();
    if (!id || isConnectionTagDescendant(id, destination.targetParentTagId, options.connectionTags)) return null;
    return { type: 'tag' as const, id, ...destination };
  }
  const id = String(options.dragNode.key || '').trim();
  return id ? { type: 'connection' as const, id, ...destination } : null;
};

export const resolveSidebarTreeOrderDropAtEvent = (
  treeData: SidebarTreeNode[],
  dragNode: SidebarTreeNode | null | undefined,
  event: SidebarTreeDragEventLike,
) => {
  if (!isSidebarTreeOrderNode(dragNode)) return null;
  const hit = resolveSidebarDropDomHit(event);
  if (!hit?.metrics) return null;
  const hoveredNode = findSidebarTreeNode(treeData, hit.key);
  if (!isSidebarTreeOrderNode(hoveredNode)) return null;
  let dropNode = hoveredNode;
  let resolvedHit = hit;
  let insertBefore = resolveSidebarDropInsertBefore(0, {
    clientY: event.clientY,
    top: hit.metrics.top,
    height: hit.metrics.height,
  });
  if (insertBefore) {
    const parent = findSidebarTreeNodeParent(treeData, String(hoveredNode.key));
    const hoveredIndex = parent?.siblings.findIndex(
      (node) => String(node.key) === String(hoveredNode.key),
    ) ?? -1;
    for (let index = hoveredIndex - 1; index >= 0; index -= 1) {
      const candidate = parent?.siblings[index];
      if (
        !isSidebarTreeOrderNode(candidate)
        || candidate.type !== hoveredNode.type
        || !isSameSidebarTreePinSection(candidate, hoveredNode)
      ) continue;
      dropNode = candidate;
      resolvedHit = { ...hit, key: String(candidate.key), type: String(candidate.type) };
      insertBefore = false;
      break;
    }
  }
  if (!canDropSidebarTreeOrderNode(
    treeData,
    dragNode,
    dropNode,
    insertBefore ? -1 : 1,
  )) return null;
  return {
    dragNode,
    dropNode,
    hit: resolvedHit,
    placement: insertBefore ? 'before' as const : 'after' as const,
  };
};

const replaceSidebarTreeChildren = (
  nodes: SidebarTreeNode[],
  parentKey: string,
  children: SidebarTreeNode[],
): SidebarTreeNode[] => {
  const directIndex = nodes.findIndex((node) => String(node.key) === parentKey);
  if (directIndex >= 0) {
    const result = [...nodes];
    result[directIndex] = { ...result[directIndex], children };
    return result;
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node.children?.length) continue;
    const nextChildren = replaceSidebarTreeChildren(node.children, parentKey, children);
    if (nextChildren === node.children) continue;
    const result = [...nodes];
    result[index] = { ...node, children: nextChildren };
    return result;
  }
  return nodes;
};

export const resolveSidebarTreeOrderDrop = (
  treeData: SidebarTreeNode[],
  source: SidebarTreeNode,
  target: SidebarTreeNode,
  insertBefore: boolean,
): SidebarTreeOrderDropResult | null => {
  const sourceParent = findSidebarTreeNodeParent(treeData, String(source.key));
  const targetParent = findSidebarTreeNodeParent(treeData, String(target.key));
  if (
    !isSidebarTreeOrderNode(source)
    || !isSidebarTreeOrderNode(target)
    || source.type !== target.type
    || !sourceParent
    || !targetParent
    || sourceParent.parentKey !== targetParent.parentKey
    || !sourceParent.parentKey
    || !isSameSidebarTreePinSection(source, target)
    || isSidebarTreeGapNoOp(treeData, source, target, insertBefore ? 'before' : 'after')
  ) {
    return null;
  }

  const sourceIndex = sourceParent.siblings.findIndex((node) => String(node.key) === String(source.key));
  const targetIndex = sourceParent.siblings.findIndex((node) => String(node.key) === String(target.key));
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;

  const nextSiblings = [...sourceParent.siblings];
  const [moved] = nextSiblings.splice(sourceIndex, 1);
  const remainingTargetIndex = nextSiblings.findIndex((node) => String(node.key) === String(target.key));
  nextSiblings.splice(remainingTargetIndex + (insertBefore ? 0 : 1), 0, moved);
  return {
    parentKey: sourceParent.parentKey,
    orderedKeys: nextSiblings
      .filter((node) => node.type === source.type)
      .map((node) => String(node.key)),
    treeData: replaceSidebarTreeChildren(treeData, sourceParent.parentKey, nextSiblings),
  };
};

export const commitSidebarTreeOrderDrop = (options: {
  treeData: SidebarTreeNode[];
  dragNode: SidebarTreeNode;
  dropNode: SidebarTreeNode;
  insertBefore: boolean;
  treeOrders: SidebarTreeOrders;
  tableSortPreference: Record<string, SidebarTableSortPreference>;
  callbacks: SidebarTreeOrderCommitCallbacks;
}): boolean => {
  const result = resolveSidebarTreeOrderDrop(
    options.treeData,
    options.dragNode,
    options.dropNode,
    options.insertBefore,
  );
  if (!result) return false;
  const nextOrders = { ...options.treeOrders, [result.parentKey]: result.orderedKeys };
  options.callbacks.onTreeData(result.treeData);
  options.callbacks.onTreeOrders(result.parentKey, result.orderedKeys, nextOrders);
  if (options.dragNode.type === 'table') {
    const connectionId = String(options.dragNode.dataRef?.id || '').trim();
    const dbName = String(options.dragNode.dataRef?.dbName || '').trim();
    if (connectionId && dbName) {
      options.callbacks.onTableSort(connectionId, dbName, {
        ...options.tableSortPreference,
        [`${connectionId}-${dbName}`]: 'manual',
      });
    }
  }
  return true;
};

const shouldApplyDirectOrder = (
  nodes: SidebarTreeNode[],
  tableSortPreference: Record<string, SidebarTableSortPreference | undefined>,
): boolean => {
  const firstOrderableNode = nodes.find(isSidebarTreeOrderNode);
  if (!firstOrderableNode || firstOrderableNode.type !== 'table') return true;
  const connectionId = String(firstOrderableNode.dataRef?.id || '').trim();
  const dbName = String(firstOrderableNode.dataRef?.dbName || '').trim();
  return Boolean(connectionId && dbName && tableSortPreference[`${connectionId}-${dbName}`] === 'manual');
};

const applyDirectSidebarTreeOrder = (
  parentKey: string,
  nodes: SidebarTreeNode[],
  orders: SidebarTreeOrders | null | undefined,
  tableSortPreference: Record<string, SidebarTableSortPreference | undefined>,
): SidebarTreeNode[] => {
  const order = orders?.[parentKey];
  if (!order?.length || !shouldApplyDirectOrder(nodes, tableSortPreference)) return nodes;
  const orderIndex = new Map(order.map((key, index) => [key, index]));
  const nodeType = nodes.find(isSidebarTreeOrderNode)?.type;
  if (!nodeType) return nodes;

  const result = [...nodes];
  let start = 0;
  while (start < result.length) {
    if (result[start].type !== nodeType) {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end < result.length && result[end].type === nodeType) end += 1;
    const segment = result.slice(start, end).map((node, index) => ({ node, index }));
    segment.sort((left, right) => {
      const leftOrder = orderIndex.get(String(left.node.key));
      const rightOrder = orderIndex.get(String(right.node.key));
      if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
      if (leftOrder !== undefined) return -1;
      if (rightOrder !== undefined) return 1;
      return left.index - right.index;
    });
    result.splice(start, end - start, ...segment.map(({ node }) => node));
    start = end;
  }
  return result;
};

const applySidebarTreeOrdersInternal = (
  parentKey: string,
  nodes: SidebarTreeNode[],
  orders: SidebarTreeOrders,
  tableSortPreference: Record<string, SidebarTableSortPreference | undefined>,
): SidebarTreeNode[] => {
  const ordered = applyDirectSidebarTreeOrder(parentKey, nodes, orders, tableSortPreference);
  let changed = ordered !== nodes;
  const result = ordered.map((node) => {
    if (!node.children?.length) return node;
    const children = applySidebarTreeOrdersInternal(
      String(node.key),
      node.children,
      orders,
      tableSortPreference,
    );
    if (children === node.children) return node;
    changed = true;
    return { ...node, children };
  });
  return changed ? result : nodes;
};

export const applySidebarTreeOrders = (
  parentKey: string,
  nodes: SidebarTreeNode[],
  orders: SidebarTreeOrders | null | undefined,
  tableSortPreference: Record<string, SidebarTableSortPreference | undefined>,
): SidebarTreeNode[] => (
  !orders || Object.keys(orders).length === 0
    ? nodes
    : applySidebarTreeOrdersInternal(parentKey, nodes, orders, tableSortPreference)
);

export const applySidebarTreeOrdersToNode = (
  node: SidebarTreeNode | null,
  orders: SidebarTreeOrders | null | undefined,
  tableSortPreference: Record<string, SidebarTableSortPreference | undefined>,
): SidebarTreeNode | null => {
  if (!node?.children?.length) return node;
  const children = applySidebarTreeOrders(String(node.key), node.children, orders, tableSortPreference);
  return children === node.children ? node : { ...node, children };
};

export const createSidebarTreeDragPreview = (
  event: SidebarTreeDragEventLike,
  node: Pick<SidebarTreeNode, 'title' | 'type'>,
): HTMLElement | null => {
  if (typeof document === 'undefined' || !document.body || !event.dataTransfer) return null;
  const preview = document.createElement('div');
  preview.className = 'gn-v2-sidebar-tree-drag-preview';
  preview.setAttribute('aria-hidden', 'true');
  preview.setAttribute('data-node-type', String(node.type || ''));
  const sourceRow = event.target && typeof (event.target as Element).closest === 'function'
    ? (event.target as Element).closest('.ant-tree-treenode')
    : null;
  const sourceIcon = sourceRow?.querySelector('.ant-tree-iconEle > *');
  const icon = document.createElement('span');
  icon.className = 'gn-v2-sidebar-tree-drag-preview-icon';
  if (sourceIcon) icon.appendChild(sourceIcon.cloneNode(true));
  preview.appendChild(icon);
  const label = document.createElement('span');
  label.className = 'gn-v2-sidebar-tree-drag-preview-label';
  label.textContent = String(node.title || '');
  preview.appendChild(label);
  document.body.appendChild(preview);
  try {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(preview, 18, 15);
  } catch {
    preview.remove();
    return null;
  }
  return preview;
};
