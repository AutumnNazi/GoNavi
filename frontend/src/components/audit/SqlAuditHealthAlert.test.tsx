import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/provider';
import SqlAuditHealthAlert from './SqlAuditHealthAlert';
import type { SQLAuditBackend } from './sqlAuditRpc';

vi.mock('../../i18n/runtime', () => ({
  syncLanguageRuntime: vi.fn(async () => undefined),
}));

vi.mock('antd', async () => {
  const React = await import('react');
  return {
    Alert: ({ message, description, action, type }: any) => React.createElement(
      'section',
      { 'data-alert-type': type },
      message,
      description,
      action,
    ),
    Spin: ({ 'aria-label': ariaLabel }: any) => React.createElement('span', { 'aria-label': ariaLabel }, 'loading'),
    Typography: {
      Text: ({ children }: any) => React.createElement('span', null, children),
    },
  };
});

const renderHealth = (backend: SQLAuditBackend, refreshKey: number, isActive = true) => (
  <I18nProvider preference="en-US" systemLanguages={['en-US']} onPreferenceChange={() => undefined}>
    <SqlAuditHealthAlert backend={backend} refreshKey={refreshKey} isActive={isActive} />
  </I18nProvider>
);

describe('SqlAuditHealthAlert', () => {
  it('shows a degraded gap and refreshes into an explicitly marked recovery', async () => {
    const getHealth = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        data: {
          status: 'degraded',
          captureEnabled: true,
          captureMode: 'redacted',
          droppedEvents: 4,
          firstFailureAt: 100,
          lastFailureAt: 200,
          lastSuccessAt: 150,
          lastError: 'audit store unavailable',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          status: 'healthy',
          captureEnabled: true,
          captureMode: 'redacted',
          droppedEvents: 4,
          firstFailureAt: 100,
          lastFailureAt: 200,
          lastSuccessAt: 300,
          lastError: '',
        },
      });
    const backend: SQLAuditBackend = { GetSQLAuditHealth: getHealth };
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(renderHealth(backend, 0));
    });
    let output = JSON.stringify(renderer!.toJSON());
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(output).toContain('Audit writing is degraded');
    expect(output).toContain('4 dropped audit events');

    await act(async () => {
      renderer!.update(renderHealth(backend, 1));
    });
    output = JSON.stringify(renderer!.toJSON());
    expect(getHealth).toHaveBeenCalledTimes(2);
    expect(output).toContain('Audit writing has recovered');
    expect(output).toContain('audit_gap');

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('labels disabled capture separately while keeping its retained mode visible', async () => {
    const backend: SQLAuditBackend = {
      GetSQLAuditHealth: vi.fn().mockResolvedValue({
        success: true,
        data: {
          status: 'healthy',
          captureEnabled: false,
          captureMode: 'metadata',
          droppedEvents: 0,
          firstFailureAt: 0,
          lastFailureAt: 0,
          lastSuccessAt: 0,
          lastError: '',
        },
      }),
    };
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(renderHealth(backend, 0));
    });
    const output = JSON.stringify(renderer!.toJSON());
    expect(output).toContain('SQL audit capture is disabled');
    expect(output).toContain('Existing records remain available to browse, verify, and export');
    expect(output).toContain('Capture mode');
    expect(output).toContain('Metadata only');
    expect(output).not.toContain('Audit writing is healthy');

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('polls health only while the audit workbench is active', async () => {
    vi.useFakeTimers();
    try {
      const getHealth = vi.fn().mockResolvedValue({
        success: true,
        data: {
          status: 'healthy',
          captureEnabled: true,
          captureMode: 'redacted',
          droppedEvents: 0,
        },
      });
      const backend: SQLAuditBackend = { GetSQLAuditHealth: getHealth };
      let renderer: ReactTestRenderer;

      await act(async () => {
        renderer = create(renderHealth(backend, 0, false));
      });
      expect(getHealth).not.toHaveBeenCalled();

      await act(async () => {
        renderer!.update(renderHealth(backend, 0, true));
      });
      expect(getHealth).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(getHealth).toHaveBeenCalledTimes(2);

      await act(async () => {
        renderer!.update(renderHealth(backend, 0, false));
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(getHealth).toHaveBeenCalledTimes(2);

      await act(async () => {
        renderer!.unmount();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
