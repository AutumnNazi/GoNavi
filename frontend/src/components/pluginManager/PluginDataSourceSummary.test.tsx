import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '../../plugins/types';
vi.mock('antd', () => {
  const element = (name: string) => (props: React.HTMLAttributes<HTMLElement>) => React.createElement('div', { ...props, 'data-component': name });
  return { Tag: element('tag'), Typography: { Text: element('text') } };
});
vi.mock('../../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { PluginDataSourceSummary } from './PluginDataSourceSummary';
const manifest: PluginManifest = { schemaVersion: 1, apiVersion: 1, id: 'example.source', name: 'Source', version: '1', permissions: ['data.sources'],
  contributes: { commands: [{ id: 'database', title: 'Database', effect: 'read' }], dataSources: [{ id: 'fixture', name: 'Fixture', dialect: 'sqlite', command: 'database', readOnly: true }] } };
describe('installed data source summary', () => {
  it('shows the command effect and hides nothing when no source is declared', () => {
    const view = create(<PluginDataSourceSummary manifest={manifest} />);
    expect(view.root.findAllByType('code').map((node) => node.children.join('')).join(' ')).toContain('database (read)');
    view.unmount();
    const empty = create(<PluginDataSourceSummary manifest={{ ...manifest, contributes: undefined }} />);
    expect(empty.toJSON()).toBeNull();
    empty.unmount();
  });
});
