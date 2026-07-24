import React from 'react';
import { Alert, Button } from 'antd';

import { t } from '../i18n';

interface DeferredWorkspaceContentErrorBoundaryProps {
  children: React.ReactNode;
  onRetry: () => void;
}

interface DeferredWorkspaceContentErrorBoundaryState {
  error: Error | null;
}

class DeferredWorkspaceContentErrorBoundary extends React.Component<
  DeferredWorkspaceContentErrorBoundaryProps,
  DeferredWorkspaceContentErrorBoundaryState
> {
  state: DeferredWorkspaceContentErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DeferredWorkspaceContentErrorBoundaryState {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div
        className="gn-deferred-workspace-content-error"
        style={{
          alignItems: 'center',
          display: 'flex',
          flex: '1 1 auto',
          justifyContent: 'center',
          minHeight: 0,
          minWidth: 0,
          overflow: 'auto',
          padding: 16,
        }}
      >
        <Alert
          type="error"
          showIcon
          message={t('common.error')}
          description={(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ overflowWrap: 'anywhere' }}>
                {error.message || String(error)}
              </div>
              <div>
                <Button type="primary" size="small" onClick={this.props.onRetry}>
                  {t('common.refresh')}
                </Button>
              </div>
            </div>
          )}
        />
      </div>
    );
  }
}

export default DeferredWorkspaceContentErrorBoundary;
