import React from 'react';
import { Button } from 'antd';

import type { AIMCPClientInstallStatus } from '../../types';
import { listMCPClientsNeedingUpdate } from '../../utils/mcpClientInstallStatus';
import { useOptionalI18n } from '../../i18n/provider';
import { translateMCPClientInstallCopy } from './mcpClientInstallPanelState';

interface AIMCPClientUpdateAllButtonProps {
  statuses: AIMCPClientInstallStatus[];
  loading: boolean;
  onUpdate: () => void;
}

const AIMCPClientUpdateAllButton: React.FC<AIMCPClientUpdateAllButtonProps> = ({
  statuses,
  loading,
  onUpdate,
}) => {
  const i18n = useOptionalI18n();
  const staleCount = listMCPClientsNeedingUpdate(statuses).length;
  if (staleCount <= 0) {
    return null;
  }
  const copy = (
    key: string,
    fallback: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => translateMCPClientInstallCopy(i18n?.t, key, fallback, params);

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Button
        type="primary"
        onClick={onUpdate}
        loading={loading}
        title={copy(
          'ai_chat.mcp_client.install.action.update_all_hint',
          'Updates only locally detected clients whose config does not yet point at this GoNavi.',
        )}
        style={{ fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        {copy(
          'ai_chat.mcp_client.install.action.update_all',
          'Update all that need updating ({{count}})',
          { count: staleCount },
        )}
      </Button>
    </div>
  );
};

export default AIMCPClientUpdateAllButton;
