import React from 'react';

export type DataGridSessionStateProps = {
  selectedRowKeys?: React.Key[];
  onSelectedRowKeysChange?: (keys: React.Key[]) => void;
  selectedCellKeys?: string[];
  onSelectedCellKeysChange?: (keys: string[]) => void;
  onPendingChangesChange?: (hasChanges: boolean) => void;
};

export const useControllableDataGridSelection = ({
  selectedRowKeys: controlledRowKeys,
  onSelectedRowKeysChange,
  selectedCellKeys: controlledCellKeys,
  onSelectedCellKeysChange,
}: DataGridSessionStateProps = {}) => {
  const [selectedRowKeys, setLocalRowKeys] = React.useState<React.Key[]>(() => controlledRowKeys || []);
  const [selectedCells, setLocalCellKeys] = React.useState<Set<string>>(
    () => new Set(controlledCellKeys || []),
  );
  const selectedRowKeysRef = React.useRef(selectedRowKeys);
  const selectedCellsRef = React.useRef(selectedCells);
  selectedRowKeysRef.current = selectedRowKeys;
  selectedCellsRef.current = selectedCells;

  React.useEffect(() => {
    if (controlledRowKeys === undefined) return;
    if (
      controlledRowKeys.length === selectedRowKeysRef.current.length
      && controlledRowKeys.every((key, index) => Object.is(key, selectedRowKeysRef.current[index]))
    ) return;
    selectedRowKeysRef.current = controlledRowKeys;
    setLocalRowKeys(controlledRowKeys);
  }, [controlledRowKeys]);

  React.useEffect(() => {
    if (controlledCellKeys === undefined) return;
    if (
      controlledCellKeys.length === selectedCellsRef.current.size
      && controlledCellKeys.every((key) => selectedCellsRef.current.has(key))
    ) return;
    const next = new Set(controlledCellKeys);
    selectedCellsRef.current = next;
    setLocalCellKeys(next);
  }, [controlledCellKeys]);

  const setSelectedRowKeys = React.useCallback<React.Dispatch<React.SetStateAction<React.Key[]>>>((next) => {
    const resolved = typeof next === 'function' ? next(selectedRowKeysRef.current) : next;
    selectedRowKeysRef.current = resolved;
    setLocalRowKeys(resolved);
    onSelectedRowKeysChange?.(resolved);
  }, [onSelectedRowKeysChange]);

  const setSelectedCells = React.useCallback<React.Dispatch<React.SetStateAction<Set<string>>>>((next) => {
    const resolved = typeof next === 'function' ? next(selectedCellsRef.current) : next;
    const cloned = new Set(resolved);
    selectedCellsRef.current = cloned;
    setLocalCellKeys(cloned);
    onSelectedCellKeysChange?.([...cloned]);
  }, [onSelectedCellKeysChange]);

  return { selectedRowKeys, setSelectedRowKeys, selectedCells, setSelectedCells };
};

export const useReportDataGridPendingChanges = (
  hasChanges: boolean,
  onPendingChangesChange?: (hasChanges: boolean) => void,
): void => {
  const lastReportedRef = React.useRef<boolean>();
  React.useEffect(() => {
    if (lastReportedRef.current === hasChanges) return;
    lastReportedRef.current = hasChanges;
    onPendingChangesChange?.(hasChanges);
  }, [hasChanges, onPendingChangesChange]);
};
