import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '../../plugins/types';
vi.mock('antd', () => ({ Typography: { Text: (props: React.HTMLAttributes<HTMLElement>) => React.createElement('div', props) } }));
vi.mock('../../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { PluginExporterSummary } from './PluginExporterSummary';
const manifest: PluginManifest = { schemaVersion: 1, apiVersion: 1, id: 'example.export', name: 'Export', version: '1', permissions: ['data.export'],
  contributes: { exporters: [{ id: 'ndjson', name: 'NDJSON', command: 'render', extension: 'ndjson', contentType: 'application/x-ndjson' }] } };
describe('installed exporter summary', () => {
  it('shows the extension and content type without a destination', () => {
    const view = create(<PluginExporterSummary manifest={manifest} />);
    const text = view.root.findAllByType('code').map((node) => node.children.join('')).join(' ');
    expect(text).toContain('ndjson');
    expect(text).toContain('application/x-ndjson');
    expect(text).not.toContain('path');
    view.unmount();
    const empty = create(<PluginExporterSummary manifest={{ ...manifest, contributes: undefined }} />);
    expect(empty.toJSON()).toBeNull();
    empty.unmount();
  });
});
