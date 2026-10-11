import React from 'react';
import { Button, Tooltip } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';

export type DataViewerMockDataButtonProps = {
  label: string;
  onClick: () => void;
};

/** 表数据页工具栏的"生成模拟数据"按钮，样式与工具栏其他图标按钮一致。 */
export const DataViewerMockDataButton: React.FC<DataViewerMockDataButtonProps> = ({ label, onClick }) => (
  <Tooltip title={label}>
    <Button
      className="gn-v2-data-grid-toolbar-action"
      data-grid-action="mock-data"
      aria-label={label}
      icon={<ExperimentOutlined />}
      onClick={onClick}
    />
  </Tooltip>
);
