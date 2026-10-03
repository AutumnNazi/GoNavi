import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('antd', async () => {
  const ReactModule = await import('react');
  const Checkbox = ({ checked, children, onChange }: any) => ReactModule.createElement(
    'label',
    null,
    ReactModule.createElement('input', {
      type: 'checkbox',
      checked,
      'data-label': children,
      onChange,
    }),
    children,
  );
  const Input = ({ value, onChange }: any) => ReactModule.createElement('input', { value, onChange });
  Input.TextArea = ({ value, onChange }: any) => ReactModule.createElement('textarea', { value, onChange });
  const Button = ({ children, onClick }: any) => ReactModule.createElement('button', { onClick }, children);
  return { Button, Checkbox, Input };
});

import DataGridColumnInfoPopoverContent from './DataGridColumnInfoPopoverContent';

describe('DataGridColumnInfoPopoverContent', () => {
  it('allows the row number column to be hidden from the column settings', () => {
    const onShowRowNumberColumnChange = vi.fn();
    const renderer = create(
      <DataGridColumnInfoPopoverContent
        darkMode={false}
        showColumnComment
        showColumnType
        alignNumericTemporalRight={false}
        showRowNumberColumn
        columnSearchText=""
        allOrderedColumnNames={['id', 'name']}
        localHiddenColumns={[]}
        enableColumnOrderMemory={false}
        enableHiddenColumnMemory={false}
        canResetOrder={false}
        canResetHidden={false}
        translate={(key) => key === 'app.theme.data_table.row_number' ? 'Show row numbers' : key}
        onShowColumnCommentChange={() => {}}
        onShowColumnTypeChange={() => {}}
        onAlignNumericTemporalRightChange={() => {}}
        onShowRowNumberColumnChange={onShowRowNumberColumnChange}
        onToggleAllColumnsVisibility={() => {}}
        onColumnSearchTextChange={() => {}}
        onToggleColumnVisibility={() => {}}
        onEnableColumnOrderMemoryChange={() => {}}
        onEnableHiddenColumnMemoryChange={() => {}}
        onResetOrder={() => {}}
        onResetHidden={() => {}}
      />,
    );

    const rowNumberCheckbox = renderer.root.findAllByType('input')
      .find((input) => input.props['data-label'] === 'Show row numbers');
    expect(rowNumberCheckbox).toBeDefined();

    act(() => rowNumberCheckbox?.props.onChange({ target: { checked: false } }));
    expect(onShowRowNumberColumnChange).toHaveBeenCalledWith(false);
  });

  it('toggles numeric/temporal cell right alignment from the display settings', () => {
    const onAlignNumericTemporalRightChange = vi.fn();
    const renderer = create(
      <DataGridColumnInfoPopoverContent
        darkMode={false}
        showColumnComment
        showColumnType
        alignNumericTemporalRight={false}
        showRowNumberColumn
        columnSearchText=""
        allOrderedColumnNames={['id', 'name']}
        localHiddenColumns={[]}
        enableColumnOrderMemory={false}
        enableHiddenColumnMemory={false}
        canResetOrder={false}
        canResetHidden={false}
        translate={(key) => key === 'data_grid.column_settings.align_numeric_temporal_right' ? 'Right align numeric' : key}
        onShowColumnCommentChange={() => {}}
        onShowColumnTypeChange={() => {}}
        onAlignNumericTemporalRightChange={onAlignNumericTemporalRightChange}
        onShowRowNumberColumnChange={() => {}}
        onToggleAllColumnsVisibility={() => {}}
        onColumnSearchTextChange={() => {}}
        onToggleColumnVisibility={() => {}}
        onEnableColumnOrderMemoryChange={() => {}}
        onEnableHiddenColumnMemoryChange={() => {}}
        onResetOrder={() => {}}
        onResetHidden={() => {}}
      />,
    );

    const alignCheckbox = renderer.root.findAllByType('input')
      .find((input) => input.props['data-label'] === 'Right align numeric');
    expect(alignCheckbox).toBeDefined();
    // 默认关闭（全左对齐）
    expect(alignCheckbox?.props.checked).toBe(false);

    act(() => alignCheckbox?.props.onChange({ target: { checked: true } }));
    expect(onAlignNumericTemporalRightChange).toHaveBeenCalledWith(true);
  });
});
