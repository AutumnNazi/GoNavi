import Modal from '../common/ResizableDraggableModal';
import { DataSyncRunDetails } from './DataSyncRunDetails';
import './DataSyncRunDetailsModal.css';
import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';

export function DataSyncRunDetailsModal(props: DataSyncRunHistoryProps) {
  if(!props.selectedRunId) return null;
  return <Modal open title={`${props.t('runs.view_details')} · ${props.selectedRunId}`}
    width={1000} footer={null} destroyOnHidden onCancel={() => props.onSelectRun('')}
    className="gn-data-sync-run-details-modal">
    <div className="gn-data-sync-run-details-body" key={props.selectedRunId}>
      <button type="button" className="gn-data-sync-button" data-run-back="true"
        onClick={() => props.onSelectRun('')}>{props.t('runs.back_to_list')}</button>
      <DataSyncRunDetails {...props} />
    </div>
  </Modal>;
}
