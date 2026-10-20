import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImportJobHistoryPanel from './ImportJobHistoryPanel';

const mocks = vi.hoisted(() => ({
  listImportJobs: vi.fn(),
  rollbackImportJob: vi.fn(),
  modalConfirm: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
}));

vi.mock('../../wailsjs/go/app/App', () => ({
  ListImportJobs: mocks.listImportJobs,
  GetImportJob: vi.fn(),
  DeleteImportJob: vi.fn(),
  CancelImportJob: vi.fn(),
  ExportImportErrorRows: vi.fn(),
  ResumeImportJob: vi.fn(),
  RetryImportJobFailedRows: vi.fn(),
  RollbackImportJob: mocks.rollbackImportJob,
}));

vi.mock('./common/ResizableDraggableModal', () => ({
  default: { confirm: mocks.modalConfirm },
}));

vi.mock('antd', async () => {
  const React = await import('react');
  const Button = ({ children, ...props }: any) => <button {...props}>{children}</button>;
  const Text = ({ children, ...props }: any) => <span {...props}>{children}</span>;
  return {
    Alert: (props: Record<string, unknown>) => React.createElement('mock-alert', props),
    Button,
    Empty: (props: Record<string, unknown>) => React.createElement('mock-empty', props),
    Typography: { Text },
    message: { error: mocks.messageError, success: mocks.messageSuccess },
  };
});

vi.mock('@ant-design/icons', () => ({
  DeleteOutlined: () => null,
  DownloadOutlined: () => null,
  EyeOutlined: () => null,
  PlayCircleOutlined: () => null,
  RedoOutlined: () => null,
  ReloadOutlined: () => null,
  RollbackOutlined: () => null,
  StopOutlined: () => null,
}));

const completedJob = {
  id: 'import-done-1',
  kind: 'sql',
  status: 'completed',
  databaseName: 'igap_pro',
  rollbackReady: true,
};

describe('ImportJobHistoryPanel rollback', () => {
  const rendered: ReactTestRenderer[] = [];

  afterEach(() => {
    act(() => {
      rendered.splice(0).forEach((renderer) => renderer.unmount());
    });
  });

  it('confirms and rolls a finished import back to its snapshot', async () => {
    mocks.listImportJobs.mockResolvedValue({ success: true, data: [completedJob] });
    mocks.rollbackImportJob.mockResolvedValue({ success: true });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ImportJobHistoryPanel />);
      await Promise.resolve();
    });
    rendered.push(renderer);

    renderer.root.findByProps({ 'data-import-history-rollback-action': 'import-done-1' }).props.onClick();
    expect(mocks.modalConfirm).toHaveBeenCalledTimes(1);

    await act(async () => {
      await mocks.modalConfirm.mock.calls[0][0].onOk();
    });

    expect(mocks.rollbackImportJob).toHaveBeenCalledWith('import-done-1');
    expect(mocks.messageSuccess).toHaveBeenCalled();
  });

  it('hides rollback when the task has no snapshot', async () => {
    mocks.listImportJobs.mockResolvedValue({
      success: true,
      data: [{ ...completedJob, id: 'import-plain-1', rollbackReady: false }],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ImportJobHistoryPanel />);
      await Promise.resolve();
    });
    rendered.push(renderer);

    expect(renderer.root.findAllByProps({ 'data-import-history-rollback-action': 'import-plain-1' })).toHaveLength(0);
  });
});
