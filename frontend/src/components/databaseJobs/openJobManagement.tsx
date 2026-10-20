import React from 'react';
import Modal from '../common/ResizableDraggableModal';
import { t } from '../../i18n';
import { JobManagementPanel } from './JobManagementPanel';
import type { JobManagementRequest } from './jobManagementRequest';

export const openJobManagement = (request: JobManagementRequest): void => {
  const dialog = Modal.confirm({
    title: t('database_jobs.manage.title'), icon: null, width: 1100, footer: null,
    closable: false, maskClosable: false, keyboard: false,
    content: <JobManagementPanel request={request} onClose={() => dialog.destroy()} />,
  });
};
