import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentLanguage } from '../i18n';
import { backendApp, findButton, flushConnectionTestTick, initialConnection, mockFormValues, setMockFormValues } from './connectionModalI18nTestSupport';
import { setUpConnectionModalI18nTest } from './connectionModalI18nTestHooks';

vi.mock('../store', async () => (await import('./connectionModalI18nTestSupport')).mockModule1());
vi.mock('../../wailsjs/go/app/App', async () => (await import('./connectionModalI18nTestSupport')).mockModule2());
vi.mock('../utils/overlayWorkbenchTheme', async () => (await import('./connectionModalI18nTestSupport')).mockModule3());
vi.mock('./DatabaseIcons', async () => (await import('./connectionModalI18nTestSupport')).mockModule4());
vi.mock('@ant-design/icons', async () => (await import('./connectionModalI18nTestSupport')).mockModule5());
vi.mock('antd', async () => ({
  ...(await import('./connectionModalI18nTestSupport')).mockModule6(),
  Collapse: ({ items }: { items: { key: string; children: ReactNode }[] }) => <>{items.map((item) => <div key={item.key}>{item.children}</div>)}</>,
}));

const testAndSaveNamespace = async (renderer: ReactTestRenderer, type: string, database: string, uri = '') => {
  await act(async () => { findButton(renderer, 'Test connection').props.onClick(); await flushConnectionTestTick(); });
  expect(backendApp.TestConnection).toHaveBeenCalledWith(expect.objectContaining({ type, database, uri }));
  expect(backendApp.DBGetDatabases).toHaveBeenCalledWith(expect.objectContaining({ type, database, uri }));
  await act(async () => { await findButton(renderer, 'Save').props.onClick(); });
  expect(backendApp.SaveConnection).toHaveBeenCalledWith(expect.objectContaining({
    config: expect.objectContaining({ type, database, uri }),
  }));
};

const namespaceInput = (renderer: ReactTestRenderer) => renderer.root.findAll(
  (node) => node.type === 'input' && node.props['aria-label'] === 'Namespace (optional)',
)[0];

describe('ConnectionModal namespace save, edit and test', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeAll(async () => { await import('./ConnectionModal'); }, 30000);
  beforeEach(() => {
    setUpConnectionModalI18nTest();
    setCurrentLanguage('en-US');
    Object.assign(window, { go: { app: { App: backendApp } } });
    backendApp.TestConnection.mockClear();
    backendApp.TestConnection.mockResolvedValue({ success: true, message: 'ok' });
    backendApp.DBGetDatabases.mockClear();
  });
  afterEach(() => {
    act(() => renderer?.unmount()); renderer = undefined;
    vi.unstubAllGlobals();
    setCurrentLanguage('zh-CN');
  });

  it.each(['iris', 'cache'])('preserves %s namespace through the real modal save/test hooks', async (type) => {
    const { default: ConnectionModal } = await import('./ConnectionModal');
    const initial = { ...initialConnection(type, { port: 1972, database: 'APP_DATA' }), includeDatabases: ['OLD_NAMESPACE'] };
    await act(async () => { renderer = create(<ConnectionModal open onClose={vi.fn()} initialValues={initial} />); });
    expect(namespaceInput(renderer!)).toBeDefined();
    expect(mockFormValues.database).toBe('APP_DATA');
    setMockFormValues({ ...mockFormValues, database: 'NEW_APP' });
    await testAndSaveNamespace(renderer!, type, 'NEW_APP');
    expect(backendApp.SaveConnection).toHaveBeenCalledWith(expect.objectContaining({ includeDatabases: ['OLD_NAMESPACE'] }));
  });

  it.each(['iris', 'cache'])('preserves blank %s namespace for discovery through test and save', async (type) => {
    const { default: ConnectionModal } = await import('./ConnectionModal');
    await act(async () => {
      renderer = create(<ConnectionModal open onClose={vi.fn()} initialValues={initialConnection(type, { port: 1972, database: '' })} />);
    });
    expect(mockFormValues.database).toBe('');
    await testAndSaveNamespace(renderer!, type, '');
  });

  it.each(['iris', 'cache'])('locks %s namespace until an encrypted stored URI is explicitly replaced', async (type) => {
    const { default: ConnectionModal } = await import('./ConnectionModal');
    const initial = { ...initialConnection(type, { port: 1972, database: '', uri: '' }), hasOpaqueURI: true };
    const onClose = vi.fn();
    await act(async () => { renderer = create(<ConnectionModal open onClose={onClose} initialValues={initial} />); });
    expect(mockFormValues.intersystemsHasStoredURI).toBe(true);
    expect(namespaceInput(renderer!).props.disabled).toBe(true);
    const uri = `${type}://localhost:1972/NEW_APP`;
    setMockFormValues({ ...mockFormValues, uri });
    await act(async () => { renderer!.update(<ConnectionModal open onClose={onClose} initialValues={initial} />); });
    expect(namespaceInput(renderer!).props).toMatchObject({ value: 'NEW_APP', disabled: true });
    await testAndSaveNamespace(renderer!, type, 'NEW_APP', uri);
  });

  it.each(['iris', 'cache'])('loads %s URI-only namespace and preserves it through test and save', async (type) => {
    const { default: ConnectionModal } = await import('./ConnectionModal');
    const uri = `${type}://user@localhost:1972/APP_DATA`;
    await act(async () => {
      renderer = create(<ConnectionModal open onClose={vi.fn()} initialValues={initialConnection(type, { port: 1972, uri })} />);
    });
    expect(mockFormValues.database).toBe('APP_DATA');
    expect(namespaceInput(renderer!).props).toMatchObject({ value: 'APP_DATA', disabled: true });
    await testAndSaveNamespace(renderer!, type, 'APP_DATA', uri);
  });

  it.each(['iris', 'cache'])('backfills the backend-effective JDBC URI path when editing %s', async (type) => {
    const { default: ConnectionModal } = await import('./ConnectionModal');
    const uri = 'jdbc:intersystems-cache://user@localhost:1972//%25SYS//?timeout=30';
    await act(async () => {
      renderer = create(<ConnectionModal open onClose={vi.fn()} initialValues={initialConnection(type, { port: 1972, database: 'OLD_NAMESPACE', uri })} />);
    });
    expect(mockFormValues.database).toBe('%SYS');
    expect(namespaceInput(renderer!).props).toMatchObject({ value: '%SYS', disabled: true });
    await testAndSaveNamespace(renderer!, type, '%SYS', uri);
  });

  it.each(['iris', 'cache'])('does not let a changed %s URI silently reuse the stale form namespace', async (type) => {
    const { default: ConnectionModal } = await import('./ConnectionModal');
    const initial = initialConnection(type, { port: 1972, uri: `${type}://localhost:1972/OLD_NAMESPACE` });
    const onClose = vi.fn();
    await act(async () => { renderer = create(<ConnectionModal open onClose={onClose} initialValues={initial} />); });
    const uri = `${type}://localhost:1972/NEW_APP`;
    setMockFormValues({ ...mockFormValues, uri });
    await act(async () => { renderer!.update(<ConnectionModal open onClose={onClose} initialValues={initial} />); });
    expect(mockFormValues.database).toBe('OLD_NAMESPACE');
    expect(namespaceInput(renderer!).props).toMatchObject({ value: 'NEW_APP', disabled: true });
    await testAndSaveNamespace(renderer!, type, 'NEW_APP', uri);
  });

  it.each(['iris', 'cache'])('allows %s manual target edits or discovery after explicitly clearing the old URI', async (type) => {
    const { default: ConnectionModal } = await import('./ConnectionModal');
    const initial = initialConnection(type, { port: 1972, uri: `${type}://localhost:1972/OLD_NAMESPACE` });
    const onClose = vi.fn();
    await act(async () => { renderer = create(<ConnectionModal open onClose={onClose} initialValues={initial} />); });
    setMockFormValues({ ...mockFormValues, uri: '', database: '' });
    await act(async () => { renderer!.update(<ConnectionModal open onClose={onClose} initialValues={initial} />); });
    expect(namespaceInput(renderer!).props.disabled).not.toBe(true);
    await testAndSaveNamespace(renderer!, type, '');
  });
});
