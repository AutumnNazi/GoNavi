import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const messageApi = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('antd', () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode }) => <button {...props}>{children}</button>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  message: messageApi,
}));

vi.mock('./MonacoEditor', () => ({
  default: () => <div data-testid="record-view-editor" />,
}));

import { DataGridTextView } from './DataGridRecordViews';

const translate = (key: string): string => ({
  'data_grid.record_view.empty': 'No rows',
  'data_grid.record_view.previous': 'Previous',
  'data_grid.record_view.next': 'Next',
  'data_grid.record_view.record_position': 'Record position',
  'data_grid.record_view.edit_current': 'Edit current',
  'data_grid.record_view.back_to_table': 'Back to table',
  'data_grid.record_view.field': 'Field',
  'data_grid.record_view.value': 'Value',
  'data_grid.record_view.comment': 'Comment',
  'data_grid.record_view.type': 'Type',
  'data_grid.record_view.copy_value': 'Copy value',
  'data_grid.message.copied_to_clipboard': 'Copied',
  'connection_modal.message.copy_failed': 'Copy failed',
}[key] ?? key);

describe('DataGridTextView value copy', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    });
    messageApi.error.mockReset();
    messageApi.success.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderView = () => create(
    <DataGridTextView
      darkMode={false}
      rowCount={1}
      textRecordIndex={0}
      canModifyData={false}
      currentTextRow={{ description: 'formatted value' }}
      displayOutputColumnNames={['description']}
      columnMetaMap={{ description: { type: 'text', comment: 'A long description' } }}
      columnMetaMapByLowerName={{}}
      translate={translate}
      onPrev={() => {}}
      onNext={() => {}}
      onEditCurrent={() => {}}
      onReturnToTable={() => {}}
      formatTextViewValue={(value) => String(value)}
    />,
  );

  it('copies a formatted value on click and keyboard activation', async () => {
    const renderer = renderView();
    const valueCell = renderer.root.find((node) => node.props['data-grid-text-value-copy'] === 'true');
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;

    await act(async () => {
      valueCell.props.onClick();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('formatted value');
    expect(messageApi.success).toHaveBeenCalledWith('Copied');

    const preventDefault = vi.fn();
    await act(async () => {
      valueCell.props.onKeyDown({ key: 'Enter', preventDefault });
      await Promise.resolve();
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('shows the existing copy failure message when the clipboard rejects', async () => {
    const renderer = renderView();
    const valueCell = renderer.root.find((node) => node.props['data-grid-text-value-copy'] === 'true');
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'));

    await act(async () => {
      valueCell.props.onClick();
      await Promise.resolve();
    });

    expect(messageApi.error).toHaveBeenCalledWith('Copy failed');
    expect(messageApi.success).not.toHaveBeenCalled();
  });
});
