import React from 'react';
import { Button, Tooltip } from 'antd';
import { LoadingOutlined, PlayCircleOutlined } from '@ant-design/icons';

export type QueryEditorToolbarRunActionProps = {
  title: string;
  ariaLabel: string;
  stopTitle: string;
  loading: boolean;
  disabled?: boolean;
  onCaptureEditorCursorPosition: () => void;
  onRun: () => void;
  onCancel: () => void;
};

export const QueryEditorToolbarRunAction: React.FC<QueryEditorToolbarRunActionProps> = ({
  title,
  ariaLabel,
  stopTitle,
  loading,
  disabled = false,
  onCaptureEditorCursorPosition,
  onRun,
  onCancel,
}) => {
  const actionTitle = loading ? stopTitle : title;
  const actionAriaLabel = loading ? stopTitle : ariaLabel;

  // Ant Design `loading` disables pointer events; keep a spinner icon so this same control can cancel.
  return (
    <Tooltip title={actionTitle}>
      <Button
        aria-label={actionAriaLabel}
        aria-busy={loading || undefined}
        className="gn-v2-query-toolbar-icon-action gn-v2-query-toolbar-run-action"
        type="primary"
        icon={loading ? <LoadingOutlined spin /> : <PlayCircleOutlined />}
        onMouseDown={loading ? undefined : onCaptureEditorCursorPosition}
        onClick={loading ? onCancel : onRun}
        disabled={loading ? false : disabled}
      />
    </Tooltip>
  );
};
