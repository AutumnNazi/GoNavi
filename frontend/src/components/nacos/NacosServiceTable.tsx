import React from 'react';
import { Button, Popconfirm, Table } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';

import NacosServiceRowStatus, {
  type NacosServiceSummaryLike,
} from './NacosServiceRowStatus';

export type NacosServiceRow = {
  rawName: string;
  serviceName: string;
  groupName: string;
};

type Translate = (
  key: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) => string;

type NacosServiceTableProps = {
  rows: NacosServiceRow[];
  statistics: Map<string, NacosServiceSummaryLike>;
  loading: boolean;
  selectedRaw: string | null;
  structureRestricted: boolean;
  mutedColor: string;
  tr: Translate;
  onSelect: (rawName: string) => void;
  onDelete: (rawName: string) => void;
};

/**
 * The service list on the left of the Nacos workbench.
 *
 * Extracted from NacosServiceViewer so the viewer file stops growing (it is far past
 * the repo's file-size limit). The health column added for issue 1303 lives here so
 * the viewer only wires the statistics map in.
 */
const NacosServiceTable: React.FC<NacosServiceTableProps> = ({
  rows,
  statistics,
  loading,
  selectedRaw,
  structureRestricted,
  mutedColor,
  tr,
  onSelect,
  onDelete,
}) => (
  <Table
    className="gn-nacos-service-table"
    size="small"
    loading={loading}
    rowKey={(row) => row.rawName}
    dataSource={rows}
    pagination={false}
    onRow={(record) => ({ onClick: () => onSelect(record.rawName) })}
    rowClassName={(record) => (selectedRaw === record.rawName ? 'ant-table-row-selected' : '')}
    columns={[
      {
        title: tr('nacos_service.field.service'),
        dataIndex: 'serviceName',
        key: 'serviceName',
        ellipsis: true,
        render: (_: unknown, row: NacosServiceRow) => (
          <div style={{ minWidth: 0 }}>
            <div
              title={row.serviceName}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {row.serviceName}
            </div>
            <div
              title={row.groupName}
              style={{
                marginTop: 2,
                color: mutedColor,
                fontSize: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {row.groupName}
            </div>
          </div>
        ),
      },
      {
        title: tr('nacos_service.field.health'),
        key: 'health',
        // Its own column rather than the tail of the name cell: that cell is
        // `ellipsis`, so a long service name would clip the badge away entirely.
        width: 132,
        render: (_: unknown, row: NacosServiceRow) => (
          <NacosServiceRowStatus
            rawName={row.rawName}
            summary={statistics.get(row.rawName)}
          />
        ),
      },
      {
        title: tr('nacos_viewer.action.delete'),
        key: 'actions',
        width: 90,
        render: (_: unknown, row: NacosServiceRow) => (
          <Popconfirm
            title={tr('nacos_service.message.confirm_delete_service', { name: row.rawName })}
            disabled={structureRestricted}
            onConfirm={() => onDelete(row.rawName)}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={structureRestricted}
            />
          </Popconfirm>
        ),
      },
    ]}
  />
);

NacosServiceTable.displayName = 'NacosServiceTable';

export default NacosServiceTable;
