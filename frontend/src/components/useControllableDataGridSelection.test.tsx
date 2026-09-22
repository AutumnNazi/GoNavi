import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { useControllableDataGridSelection } from './useControllableDataGridSelection';

describe('useControllableDataGridSelection', () => {
  it('restores controlled row and cell selection and reports updates', () => {
    const onSelectedRowKeysChange = vi.fn();
    const onSelectedCellKeysChange = vi.fn();
    const controlledRowKeys = ['row-2'];
    const controlledCellKeys = ['row-2\u0000name'];
    let state!: ReturnType<typeof useControllableDataGridSelection>;

    const Harness = () => {
      state = useControllableDataGridSelection({
        selectedRowKeys: controlledRowKeys,
        selectedCellKeys: controlledCellKeys,
        onSelectedRowKeysChange,
        onSelectedCellKeysChange,
      });
      return null;
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Harness />);
    });
    expect(state.selectedRowKeys).toEqual(['row-2']);
    expect([...state.selectedCells]).toEqual(['row-2\u0000name']);

    act(() => {
      state.setSelectedRowKeys(['row-3']);
      state.setSelectedCells(new Set(['row-3\u0000email']));
    });
    expect(onSelectedRowKeysChange).toHaveBeenCalledWith(['row-3']);
    expect(onSelectedCellKeysChange).toHaveBeenCalledWith(['row-3\u0000email']);
    expect(state.selectedRowKeys).toEqual(['row-3']);
    expect([...state.selectedCells]).toEqual(['row-3\u0000email']);
    renderer.unmount();
  });
});
