import React, { useMemo } from 'react';
import { Alert, Empty, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MockDataPreviewState } from './hooks/useMockDataRun';

type Translate = (key: string, params?: Record<string, string | number>) => string;

type PreviewRow = { __row: number; cells: Record<string, string | null> };

export type MockDataPreviewPanelProps = {
  preview: MockDataPreviewState;
  t: Translate;
};

/** 预览前若干行：与实际写入的前几行完全一致（同一随机种子）。 */
export const MockDataPreviewPanel: React.FC<MockDataPreviewPanelProps> = ({ preview, t }) => {
  const columns = useMemo<ColumnsType<PreviewRow>>(() => (preview.data?.columns || []).map((name) => ({
    title: name,
    key: name,
    width: 160,
    ellipsis: true,
    render: (_: unknown, row: PreviewRow) => {
      const value = row.cells[name];
      return value === null || value === undefined
        ? <Typography.Text type="secondary" italic>NULL</Typography.Text>
        : value;
    },
  })), [preview.data?.columns]);
  const rows = useMemo<PreviewRow[]>(() => (preview.data?.rows || []).map((cells, index) => ({ __row: index, cells })), [preview.data?.rows]);

  if (preview.status === 'error') {
    return <Alert type="error" showIcon message={t('mock_data.preview.failed')} description={preview.message} />;
  }
  if (preview.status === 'idle') {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mock_data.preview.empty')} />;
  }
  return (
    <Table<PreviewRow>
      className="gn-mock-data-preview-table"
      size="small"
      rowKey="__row"
      loading={preview.status === 'loading'}
      pagination={false}
      columns={columns}
      dataSource={rows}
      scroll={{ x: Math.max(columns.length * 160, 600) }}
    />
  );
};
