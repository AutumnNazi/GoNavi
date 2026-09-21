import { arrayMove } from '@dnd-kit/sortable';
import { useEffect, useMemo, useState } from 'react';

export const useDataGridColumnLayout = (
  visibleColumnNames: string[],
  storedOrder?: string[],
  storedHidden?: string[],
  contextKey?: string,
) => {
  const nextOrder = useMemo(() => {
    if (!storedOrder?.length) return visibleColumnNames;
    const incoming = new Set(visibleColumnNames);
    const stored = new Set(storedOrder);
    return [...storedOrder.filter(name => incoming.has(name)),
      ...visibleColumnNames.filter(name => !stored.has(name))];
  }, [visibleColumnNames, storedOrder]);
  const [allOrderedColumnNames, setAllOrderedColumnNames] = useState(nextOrder);
  const [localHiddenColumns, setLocalHiddenColumns] = useState<string[]>(() => storedHidden || []);
  useEffect(() => { setAllOrderedColumnNames(nextOrder); }, [nextOrder, contextKey]);
  useEffect(() => {
    setLocalHiddenColumns(current => storedHidden || (current.length ? [] : current));
  }, [storedHidden, contextKey]);
  return { allOrderedColumnNames, setAllOrderedColumnNames, localHiddenColumns, setLocalHiddenColumns };
};

export const DATA_GRID_COLUMN_ORDER_DRAG_MIME = 'application/x-gonavi-data-grid-column-order';

export type DataGridColumnOrderDragPayload = {
  scope: string;
  columnName: string;
};

export const encodeDataGridColumnOrderDragPayload = (
  payload: DataGridColumnOrderDragPayload,
): string => JSON.stringify(payload);

export const decodeDataGridColumnOrderDragPayload = (
  rawPayload: string,
): DataGridColumnOrderDragPayload | null => {
  try {
    const parsed = JSON.parse(String(rawPayload || ''));
    const scope = String(parsed?.scope || '').trim();
    const columnName = String(parsed?.columnName || '').trim();
    return scope && columnName ? { scope, columnName } : null;
  } catch {
    return null;
  }
};

export const hasDataGridColumnOrderDragPayload = (
  dataTransfer: Pick<DataTransfer, 'types'> | null | undefined,
): boolean => Array.from(dataTransfer?.types || [])
  .some((type) => String(type || '').toLowerCase() === DATA_GRID_COLUMN_ORDER_DRAG_MIME);

// Native HTML drag handles mouse reliably; touch and pen need dnd-kit's PointerSensor.
export const shouldBypassDndKitForNativeColumnHeaderDrag = (pointerType: string): boolean => (
  pointerType === 'mouse'
);

export const moveDataGridColumnInVisibleOrder = (
  allColumnNames: string[],
  hiddenColumnNames: ReadonlySet<string>,
  sourceColumnName: string,
  targetColumnName: string,
): string[] => {
  const source = String(sourceColumnName || '').trim();
  const target = String(targetColumnName || '').trim();
  if (!source || !target || source === target) return allColumnNames;

  const visibleColumnNames = allColumnNames.filter((columnName) => !hiddenColumnNames.has(columnName));
  const sourceIndex = visibleColumnNames.indexOf(source);
  const targetIndex = visibleColumnNames.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return allColumnNames;

  const nextVisibleColumnNames = arrayMove(visibleColumnNames, sourceIndex, targetIndex);
  let visibleIndex = 0;
  return allColumnNames.map((columnName) => (
    hiddenColumnNames.has(columnName) ? columnName : nextVisibleColumnNames[visibleIndex++]
  ));
};

export const resolveDataGridDisplayColumnNames = ({
  visibleColumnNames,
  orderedColumnNames,
  hiddenColumnNames,
  pinnedLeftColumnNames,
}: {
  visibleColumnNames: string[];
  orderedColumnNames: string[];
  hiddenColumnNames: ReadonlySet<string>;
  pinnedLeftColumnNames: string[];
}): string[] => {
  const visibleSet = new Set(visibleColumnNames);
  const orderedSet = new Set(orderedColumnNames);
  const orderedSnapshotIsCurrent = orderedColumnNames.length === visibleColumnNames.length
    && orderedSet.size === visibleSet.size
    && orderedColumnNames.every((columnName) => visibleSet.has(columnName));
  const currentOrder = orderedSnapshotIsCurrent ? orderedColumnNames : visibleColumnNames;
  const visible = currentOrder.filter((columnName) => !hiddenColumnNames.has(columnName));
  if (pinnedLeftColumnNames.length === 0) {
    return visible;
  }

  const visibleColumns = new Set(visible);
  const pinnedVisible = pinnedLeftColumnNames.filter((columnName) => visibleColumns.has(columnName));
  const pinnedSet = new Set(pinnedVisible);
  return [...pinnedVisible, ...visible.filter((columnName) => !pinnedSet.has(columnName))];
};
