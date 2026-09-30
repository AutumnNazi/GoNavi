import React from 'react';
import { Button, Modal, Popconfirm, Space, Spin, Tag } from 'antd';

import { type I18nParams } from '../i18n';
import Editor from './MonacoEditor';

type HistoryRecord = {
  id: string;
  dataId: string;
  group: string;
  content?: string;
  opType?: string;
  createdTime?: string;
  modifiedTime?: string;
};

type Props = {
  open: boolean;
  loading: boolean;
  history: HistoryRecord | null;
  currentConfig: { dataId: string; group: string } | null;
  language: string;
  readOnly: boolean;
  rollingBack: boolean;
  onClose: () => void;
  onRollback: (record: HistoryRecord) => void;
  tr: (key: string, params?: I18nParams) => string;
};

const NacosHistoryDetailModal: React.FC<Props> = ({
  open, loading, history, currentConfig, language, readOnly, rollingBack,
  onClose, onRollback, tr,
}) => {

  return (
    <Modal
      title={tr('nacos_viewer.action.view_history')}
      open={open}
      onCancel={onClose}
      width={720}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>{tr('common.cancel')}</Button>
          <Popconfirm
            title={tr('nacos_viewer.message.confirm_rollback', {
              group: currentConfig?.group || '',
              dataId: currentConfig?.dataId || '',
              id: history?.id || '',
            })}
            disabled={readOnly || !history}
            onConfirm={() => history && onRollback(history)}
          >
            <Button type="primary" disabled={readOnly || !history} loading={rollingBack}>
              {tr('nacos_viewer.action.rollback')}
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      {loading ? (
        <div style={{ minHeight: 200, display: 'grid', placeItems: 'center' }}><Spin /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Space wrap>
            <Tag>{history?.id}</Tag>
            <Tag>{history?.opType || '-'}</Tag>
            <Tag>{history?.modifiedTime || history?.createdTime || '-'}</Tag>
          </Space>
          <Editor
            height={360}
            gonaviTypography="data"
            language={language}
            value={history?.content ?? ''}
            options={{
              readOnly: true,
              domReadOnly: true,
              minimap: { enabled: false },
              lineNumbers: 'on',
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      )}
    </Modal>
  );
};

export default NacosHistoryDetailModal;
