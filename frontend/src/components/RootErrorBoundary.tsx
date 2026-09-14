import React from 'react';

import { hideBootSplash } from '../utils/bootSplash';

interface RootErrorBoundaryProps {
  children: React.ReactNode;
}

interface RootErrorBoundaryState {
  error: Error | null;
}

class RootErrorBoundary extends React.Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch() {
    hideBootSplash();
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        data-testid="gonavi-root-error"
        style={{
          alignItems: 'center',
          background: 'var(--gn-bg-app, #f4f6f8)',
          boxSizing: 'border-box',
          color: '#111827',
          display: 'flex',
          fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
          height: '100%',
          justifyContent: 'center',
          padding: 24,
          whiteSpace: 'pre-wrap',
        }}
      >
        {error.message || String(error)}
      </div>
    );
  }
}

export default RootErrorBoundary;
