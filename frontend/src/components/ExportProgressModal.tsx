import Modal from './common/ResizableDraggableModal';
import React from 'react';
import { Button, Typography } from 'antd';
import {
  formatExportProgressRows,
} from '../utils/exportProgress';
import { t } from '../i18n';
import ExportProgressBar from './ExportProgressBar';
import { useExportProgressRunner } from './useExportProgressRunner';
import { APP_NESTED_MODAL_Z_INDEX } from '../utils/overlayZIndex';

const { Text, Paragraph } = Typography;

export function useExportProgressDialog() {
  const { state, reset, runExportWithProgress } = useExportProgressRunner();

  const canClose = state.status === 'done' || state.status === 'error';

  const modalNode = (
    <Modal
      title={state.status === 'error'
        ? t('data_export.progress.title.error')
        : (state.status === 'done' ? t('data_export.progress.title.done') : t('data_export.progress.title.running'))}
      open={state.open}
      zIndex={APP_NESTED_MODAL_Z_INDEX}
      width={560}
      mask={false}
      keyboard={canClose}
      closable={canClose}
      onCancel={reset}
      footer={canClose ? [
        <Button key="close" onClick={reset}>{t('common.close')}</Button>,
      ] : null}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', rowGap: 8, columnGap: 8 }}>
          <Text type="secondary">{t('data_export.progress.label.task')}</Text>
          <Text>{state.title || state.targetName || t('data_export.progress.value.task_fallback')}</Text>

          <Text type="secondary">{t('data_export.label.object')}</Text>
          <Text>{state.targetName || t('data_export.progress.value.target_fallback')}</Text>

          <Text type="secondary">{t('data_export.label.format')}</Text>
          <Text>{state.format || '-'}</Text>

          <Text type="secondary">{t('data_export.label.status')}</Text>
          <Text>{state.stage || t('data_export.progress.status.start')}</Text>

          {state.filePath ? (
            <>
              <Text type="secondary">{t('data_export.label.file')}</Text>
              <Paragraph style={{ marginBottom: 0, wordBreak: 'break-all' }}>{state.filePath}</Paragraph>
            </>
          ) : null}
        </div>

        <ExportProgressBar
          status={state.status}
          current={state.current}
          total={state.total}
          totalRowsKnown={state.totalRowsKnown}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Text type="secondary">{formatExportProgressRows(state.current, state.total, state.totalRowsKnown)}</Text>
          {!state.totalRowsKnown && state.status !== 'done' && state.status !== 'error' ? (
            <Text type="secondary">{t('data_export.hint.rows_unknown')}</Text>
          ) : null}
          {state.message ? (
            <Text type="danger">{state.message}</Text>
          ) : null}
        </div>
      </div>
    </Modal>
  );

  return {
    exportProgressModal: modalNode,
    runExportWithProgress,
  };
}
