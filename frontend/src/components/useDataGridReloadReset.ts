import React, { useEffect, useRef } from 'react';
import { GONAVI_ROW_KEY } from './DataGridCore';

type Item = Record<string, any>;

export interface UseDataGridReloadResetOptions {
  /** 查询结果数据：引用变化即视为一次重新查询/刷新 */
  data: Item[];
  resetCellSelection: () => void;
  setSelectedRowKeys: (keys: React.Key[]) => void;
  deletedRowKeys: Set<string>;
  setDeletedRowKeys: (next: Set<string>) => void;
}

/**
 * 重新查询/刷新时重置挂起的行选中与挂起删除状态。
 *
 * 行键是行在结果集中的索引（加载时按 i 编号），重新查询后新结果的行键会
 * 重新编号：残留的选中集合与挂起删除集合会错位到新结果的同索引行上
 * （渲染为删除线，提交时生成错误的 DELETE）。因此 data 引用变化时必须
 * 同步清空两者。
 *
 * selectionResetSourceDataRef 供外部 display-data effect 读取：React 可能
 * 在 setSelectedCells 重置渲染前先跑两个 effect，旧选中不得在此间隙与
 * 新结果集求交。
 */
export function useDataGridReloadReset(options: UseDataGridReloadResetOptions): {
  selectionResetSourceDataRef: React.MutableRefObject<Item[] | null>;
} {
  const { data, resetCellSelection, setSelectedRowKeys, deletedRowKeys, setDeletedRowKeys } = options;

  const previousSelectionSourceDataRef = useRef(data);
  const selectionResetSourceDataRef = useRef<Item[] | null>(null);
  const deletedRowKeysRef = useRef(deletedRowKeys);
  useEffect(() => { deletedRowKeysRef.current = deletedRowKeys; }, [deletedRowKeys]);

  useEffect(() => {
    if (previousSelectionSourceDataRef.current === data) return;
    previousSelectionSourceDataRef.current = data;
    selectionResetSourceDataRef.current = data;
    setSelectedRowKeys([]);
    // 重新查询/筛选后行键已重新编号，旧的挂起删除标记会错位到新结果的
    // 同索引行上（渲染为删除线、提交时生成错误的 DELETE），必须清除。
    if (deletedRowKeysRef.current.size > 0) {
      setDeletedRowKeys(new Set());
    }
    resetCellSelection();
  }, [data, resetCellSelection, setDeletedRowKeys]);

  return { selectionResetSourceDataRef };
}
