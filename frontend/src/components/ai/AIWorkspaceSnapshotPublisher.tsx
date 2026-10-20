import { memo } from 'react';
import { useAIWorkspaceSnapshot } from './useAIWorkspaceSnapshot';

// Application-lifetime publisher, independent of the optional chat panel.
// Keeping the subscription here prevents tab/context updates rendering App.
export const AIWorkspaceSnapshotPublisher = memo(function AIWorkspaceSnapshotPublisher() {
  useAIWorkspaceSnapshot();
  return null;
});
