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
});
