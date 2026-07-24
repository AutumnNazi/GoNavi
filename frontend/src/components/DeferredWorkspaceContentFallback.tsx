import React from 'react';
import { Spin } from 'antd';

const DeferredWorkspaceContentFallback: React.FC = () => (
  <div
    className="gn-deferred-workspace-content"
    aria-busy="true"
    style={{
      alignItems: 'center',
      display: 'flex',
      flex: '1 1 auto',
      justifyContent: 'center',
      minHeight: 0,
      minWidth: 0,
    }}
  >
    <Spin size="small" />
  </div>
);

export default DeferredWorkspaceContentFallback;
