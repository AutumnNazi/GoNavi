import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabData } from '../types';
import { I18nProvider } from '../i18n/provider';

const state = vi.hoisted(() => ({
  connections: [{ id: 'conn', name: 'Oracle', config: { type: 'oracle', host: 'localhost', port: 1521, user: 'APP', database: 'ORCL' } }],
  theme: 'light', addTab: vi.fn(), setActiveContext: vi.fn(),
}));
const backend = vi.hoisted(() => ({ DBQuery: vi.fn(), DBShowCreateTable: vi.fn() }));
vi.mock('../store', () => ({ useStore: (selector: (value: typeof state) => unknown) => selector(state) }));
vi.mock('../../wailsjs/go/app/App', () => backend);
vi.mock('../i18n/runtime', () => ({ syncLanguageRuntime: vi.fn(async () => undefined) }));
vi.mock('@ant-design/icons', () => ({ EditOutlined: () => <span /> }));
vi.mock('./MonacoEditor', () => ({
  default: ({ value, options }: { value: string; options: { readOnly?: boolean } }) => (
    <pre data-readonly={String(options.readOnly)}>{value}</pre>
  ),
}));
vi.mock('antd', () => ({
  Spin: ({ tip }: { tip: string }) => <span>{tip}</span>,
  Alert: ({ message, description }: { message: string; description?: string }) => <aside>{message}{description}</aside>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));
import DefinitionViewer from './DefinitionViewer';

const tab: TabData = {
  id: 'job-1', title: 'NIGHTLY', type: 'job-def', connectionId: 'conn',
  dbName: 'APP', schemaName: 'APP', jobName: 'NIGHTLY', jobKind: 'oracle-scheduler',
};
const render = (value: TabData) => (
  <I18nProvider preference="en-US" systemLanguages={['en-US']} onPreferenceChange={() => undefined}>
    <DefinitionViewer tab={value} />
  </I18nProvider>
);
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };

beforeEach(() => {
  backend.DBQuery.mockReset();
  backend.DBShowCreateTable.mockReset();
});

describe('job definition viewer', () => {
  it('keeps the catalog read-only and exposes separate job management', async () => {
    backend.DBQuery.mockResolvedValue({ success: true, data: [{ JOB_NAME: 'NIGHTLY', ACTION: 'BEGIN CLEANUP; END;' }] });
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(render(tab)); await flush(); });
    expect(renderer!.root.findByType('pre').props['data-readonly']).toBe('true');
    expect(renderer!.root.findByType('pre').children.join('')).toContain('BEGIN CLEANUP; END;');
    expect(renderer!.root.findAllByType('button')).toHaveLength(1);
    expect(renderer!.root.findByType('button').children.join('')).toContain('Manage job');
    await act(async () => renderer!.unmount());
  });

  it('reloads when the job source changes while name and owner stay the same', async () => {
    backend.DBQuery.mockImplementation(async (_config: unknown, _db: string, sql: string) => ({
      success: true, data: [{ JOB_NAME: '7', ACTION: sql.includes('ALL_SCHEDULER_JOBS') ? 'SCHEDULER_ACTION;' : 'LEGACY_ACTION;' }],
    }));
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(render({ ...tab, jobName: '7' })); await flush(); });
    expect(renderer!.root.findByType('pre').children.join('')).toContain('SCHEDULER_ACTION;');
    await act(async () => { renderer!.update(render({ ...tab, jobName: '7', jobKind: 'dbms-job' })); await flush(); });
    expect(renderer!.root.findByType('pre').children.join('')).toContain('LEGACY_ACTION;');
    expect(renderer!.root.findByType('pre').children.join('')).not.toContain('SCHEDULER_ACTION;');
    await act(async () => renderer!.unmount());
  });
});
