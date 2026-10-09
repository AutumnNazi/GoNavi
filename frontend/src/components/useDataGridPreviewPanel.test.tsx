import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { useDataGridPreviewPanel, type UseDataGridPreviewPanelResult } from './useDataGridPreviewPanel';

describe('useDataGridPreviewPanel', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = null;
  });

  it('closes the preview when the result becomes empty and keeps it closed', () => {
    let controller!: UseDataGridPreviewPanelResult;
    let setPreviewAvailable!: React.Dispatch<React.SetStateAction<boolean>>;

    const Harness = () => {
      const [previewAvailable, setAvailable] = React.useState(true);
      setPreviewAvailable = setAvailable;
      controller = useDataGridPreviewPanel({
        previewAvailable,
        toEditableText: (value) => String(value ?? ''),
        looksLikeJsonText: () => false,
        normalizeDateTimeString: (value) => value,
      });
      return null;
    };

    act(() => {
      renderer = create(<Harness />);
    });
    act(() => {
      controller.toggleDataPanel();
      controller.updateFocusedCell({ id: 1 }, 'id');
    });

    expect(controller.dataPanelOpen).toBe(true);
    expect(controller.focusedCellInfo?.dataIndex).toBe('id');

    act(() => {
      setPreviewAvailable(false);
    });

    expect(controller.dataPanelOpen).toBe(false);
    expect(controller.dataPanelOpenRef.current).toBe(false);
    expect(controller.focusedCellInfo).toBeNull();
    expect(controller.dataPanelValue).toBe('');

    act(() => {
      controller.toggleDataPanel();
    });

    expect(controller.dataPanelOpen).toBe(false);
    expect(controller.dataPanelOpenRef.current).toBe(false);
  });

  it('invalidates the old focus when one nonempty query replaces another', () => {
    const firstData = [{ id: 2, name: 'Bob' }];
    const secondData = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
    let controller!: UseDataGridPreviewPanelResult;
    let oldSourceCheck: (() => boolean) | undefined;
    let oldSourceCurrentDuringRender: boolean | undefined;

    const Harness = ({ data }: { data: typeof firstData }) => {
      controller = useDataGridPreviewPanel({
        previewAvailable: data.length > 0,
        sourceData: data,
        toEditableText: (value) => String(value ?? ''),
        looksLikeJsonText: () => false,
        normalizeDateTimeString: (value) => value,
      });
      if (data === secondData && oldSourceCheck) {
        oldSourceCurrentDuringRender = oldSourceCheck();
      }
      return null;
    };

    act(() => { renderer = create(<Harness data={firstData} />); });
    act(() => {
      controller.toggleDataPanel();
      controller.updateFocusedCell(firstData[0], 'name');
    });
    oldSourceCheck = controller.isFocusedCellSourceCurrent;
    expect(oldSourceCheck()).toBe(true);

    act(() => { renderer!.update(<Harness data={secondData} />); });
    expect(oldSourceCurrentDuringRender).toBe(false);
    expect(oldSourceCheck()).toBe(false);
    expect(controller.isFocusedCellSourceCurrent()).toBe(false);
    expect(controller.dataPanelOpen).toBe(false);
    expect(controller.dataPanelOpenRef.current).toBe(false);
    expect(controller.focusedCellInfo).toBeNull();
    expect(controller.dataPanelValue).toBe('');
    expect(controller.dataPanelOriginalRef.current).toBe('');
    expect(controller.dataPanelDirtyRef.current).toBe(false);

    act(() => {
      controller.toggleDataPanel();
      controller.updateFocusedCell(secondData[0], 'name');
    });
    expect(controller.isFocusedCellSourceCurrent()).toBe(true);
    expect(oldSourceCheck()).toBe(false);
    expect(controller.dataPanelValue).toBe('Alice');
  });

  it('keeps the focused preview open through editing rerenders of the same query', () => {
    const data = [{ id: 2, name: 'Bob' }];
    let controller!: UseDataGridPreviewPanelResult;
    const Harness = () => {
      controller = useDataGridPreviewPanel({
        previewAvailable: true,
        sourceData: data,
        toEditableText: (value) => String(value ?? ''),
        looksLikeJsonText: () => false,
        normalizeDateTimeString: (value) => value,
      });
      return null;
    };

    act(() => { renderer = create(<Harness />); });
    act(() => {
      controller.toggleDataPanel();
      controller.updateFocusedCell(data[0], 'name');
    });
    act(() => {
      controller.setDataPanelValue('Bob edited');
      controller.dataPanelDirtyRef.current = true;
    });
    act(() => { renderer!.update(<Harness />); });

    expect(controller.dataPanelOpen).toBe(true);
    expect(controller.focusedCellInfo?.record).toBe(data[0]);
    expect(controller.isFocusedCellSourceCurrent()).toBe(true);
    expect(controller.dataPanelValue).toBe('Bob edited');
    expect(controller.dataPanelOriginalRef.current).toBe('Bob');
    expect(controller.dataPanelDirtyRef.current).toBe(true);
  });
});
