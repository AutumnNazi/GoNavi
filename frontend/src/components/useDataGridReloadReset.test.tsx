import React from 'react';
import { act } from 'react-test-renderer';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDataGridReloadReset } from './useDataGridReloadReset';

let latest: {
  deletedRowKeysCleared: boolean;
  selectionCleared: boolean;
  cellSelectionReset: boolean;
} | null = null;

function Harness(props: {
  data: Record<string, any>[];
  deletedRowKeys: Set<string>;
}) {
  const result = useDataGridReloadReset({
    data: props.data,
    resetCellSelection: () => { latest!.cellSelectionReset = true; },
    setSelectedRowKeys: () => { latest!.selectionCleared = true; },
    deletedRowKeys: props.deletedRowKeys,
    setDeletedRowKeys: (next) => { latest!.deletedRowKeysCleared = next.size === 0; },
  });
  // 触发 ref 快照的同步 effect
  latest!.cellSelectionReset = latest!.cellSelectionReset ?? false;
  return null;
}

const dataA = [{ __gonavi_row_key__: 0 }];
const dataB = [{ __gonavi_row_key__: 0 }, { __gonavi_row_key__: 1 }];

describe('useDataGridReloadReset', () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    latest = { deletedRowKeysCleared: false, selectionCleared: false, cellSelectionReset: false };
    renderer = null;
  });

  const mount = async (props: { data: Record<string, any>[]; deletedRowKeys: Set<string> }) => {
    await act(async () => {
      renderer = create(<Harness data={props.data} deletedRowKeys={props.deletedRowKeys} />);
    });
  };

  const update = async (props: { data: Record<string, any>[]; deletedRowKeys: Set<string> }) => {
    await act(async () => {
      renderer!.update(<Harness data={props.data} deletedRowKeys={props.deletedRowKeys} />);
    });
  };

  it('data 引用变化时清空挂起删除与选中', async () => {
    await mount({ data: dataA, deletedRowKeys: new Set(['0']) });
    // 同 data 引用的 effect 重跑不产生动作
    await update({ data: dataA, deletedRowKeys: new Set(['0']) });
    // data 引用变化 → 清空
    await update({ data: dataB, deletedRowKeys: new Set(['0']) });
    expect(latest!.deletedRowKeysCleared).toBe(true);
    expect(latest!.selectionCleared).toBe(true);
  });

  it('data 不变时重跑 effect 不清空挂起删除', async () => {
    await mount({ data: dataA, deletedRowKeys: new Set(['0']) });
    // deletedRowKeys 变化（挂起新删除）但 data 引用不变 → 不应触发清空信号
    await update({ data: dataA, deletedRowKeys: new Set(['0', '1']) });
    expect(latest!.deletedRowKeysCleared).toBe(false);
  });

  it('空删除集合时 data 变化不触发多余 setState', async () => {
    await mount({ data: dataA, deletedRowKeys: new Set() });
    await update({ data: dataB, deletedRowKeys: new Set() });
    // 无挂起删除时 setDeletedRowKeys 不被调用（deletedRowKeysCleared 保持初值）
    expect(latest!.deletedRowKeysCleared).toBe(false);
  });
});
