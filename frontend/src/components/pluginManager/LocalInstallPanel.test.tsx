import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ inspect: vi.fn(), install: vi.fn(), replace: vi.fn() }));
const picker = vi.hoisted(() => ({ pickPluginPackageFile: vi.fn(), pickPluginPackageDirectory: vi.fn() }));
const runtime = vi.hoisted(() => ({ isWebRuntime: vi.fn(() => false) }));
vi.mock('../../plugins/api', () => ({ pluginAPI: api }));
vi.mock('./pluginPackagePicker', () => picker);
vi.mock('../../utils/browserFileTransfer', () => runtime);
vi.mock('../../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('antd', () => {
  const element = (name: string) => (props: React.HTMLAttributes<HTMLElement>) => React.createElement('div', { ...props, 'data-component': name });
  return { Alert: element('alert'), Button: element('button'), Input: element('input'), Typography: { Text: element('text') } };
});
vi.mock('./PluginInstallPreview', () => ({
  PluginInstallPreview: (props: Record<string, unknown>) => React.createElement('div', { 'data-component': 'preview', ...props }),
}));
import { LocalInstallPanel } from './LocalInstallPanel';
const inspection = {
  manifest: { schemaVersion: 1, apiVersion: 1, id: 'test.hello', name: 'Hello', version: '1.0.0', permissions: [] },
  digest: 'c'.repeat(64), sourcePath: '/tmp/plugin.zip', sizeBytes: 10,
};
async function inspectPath(view: ReturnType<typeof create>) {
  await act(async () => { view.root.findByProps({ 'data-component': 'input' }).props.onChange({ target: { value: '/tmp/plugin.zip' } }); });
  const inspectButton = view.root.findAllByProps({ 'data-component': 'button' }).find((node) => node.children.includes('plugin.install.inspect'));
  await act(async () => { await inspectButton!.props.onClick(); });
  return view.root.findByProps({ 'data-component': 'preview' });
}
describe('local install chooses replace for an installed plugin', () => {
  afterEach(() => { vi.clearAllMocks(); runtime.isWebRuntime.mockReturnValue(false); });
  it('installs a new plugin and replaces an installed one', async () => {
    api.inspect.mockResolvedValue(inspection);
    api.install.mockResolvedValue({});
    api.replace.mockResolvedValue({});
    const fresh = create(<LocalInstallPanel allowed onInstalled={vi.fn()} installedIds={new Set<string>()} />);
    let preview = await inspectPath(fresh);
    expect(preview.props.replace).toBe(false);
    await act(async () => { await preview.props.onInstall(); });
    expect(api.install).toHaveBeenCalledWith('/tmp/plugin.zip', inspection.digest, true);
    expect(api.replace).not.toHaveBeenCalled();
    fresh.unmount();
    api.install.mockClear();
    const installed = create(<LocalInstallPanel allowed onInstalled={vi.fn()} installedIds={new Set(['test.hello'])} />);
    preview = await inspectPath(installed);
    expect(preview.props.replace).toBe(true);
    await act(async () => { await preview.props.onInstall(); });
    expect(api.replace).toHaveBeenCalledWith('/tmp/plugin.zip', inspection.digest, true);
    expect(api.install).not.toHaveBeenCalled();
    installed.unmount();
  });
});

const buttonByText = (view: ReturnType<typeof create>, text: string) => (
  view.root.findAllByProps({ 'data-component': 'button' }).find((node) => node.children.includes(text))
);

describe('local install package picker', () => {
  afterEach(() => { vi.clearAllMocks(); runtime.isWebRuntime.mockReturnValue(false); });

  it('fills the selected path and inspects it immediately', async () => {
    api.inspect.mockResolvedValue(inspection);
    picker.pickPluginPackageFile.mockResolvedValue({ status: 'selected', path: '/tmp/picked.zip' });
    const view = create(<LocalInstallPanel allowed onInstalled={vi.fn()} />);
    const chooseFile = buttonByText(view, 'plugin.install.select_file');
    expect(chooseFile).toBeTruthy();
    await act(async () => { await chooseFile!.props.onClick(); });
    expect(picker.pickPluginPackageFile).toHaveBeenCalledWith('');
    expect(view.root.findByProps({ 'data-component': 'input' }).props.value).toBe('/tmp/picked.zip');
    expect(api.inspect).toHaveBeenCalledWith('/tmp/picked.zip');
    expect(view.root.findByProps({ 'data-component': 'preview' }).props.inspection).toBe(inspection);
    view.unmount();
  });

  it('treats a canceled picker as a no-op', async () => {
    picker.pickPluginPackageDirectory.mockResolvedValue({ status: 'canceled' });
    const view = create(<LocalInstallPanel allowed onInstalled={vi.fn()} />);
    await act(async () => { await buttonByText(view, 'plugin.install.select_directory')!.props.onClick(); });
    expect(api.inspect).not.toHaveBeenCalled();
    expect(view.root.findAllByProps({ 'data-component': 'alert' })).toHaveLength(0);
    view.unmount();
  });

  it('shows a localized hint when the picker cannot open', async () => {
    picker.pickPluginPackageFile.mockResolvedValue({ status: 'failed' });
    const view = create(<LocalInstallPanel allowed onInstalled={vi.fn()} />);
    await act(async () => { await buttonByText(view, 'plugin.install.select_file')!.props.onClick(); });
    const alert = view.root.findAllByProps({ 'data-component': 'alert' }).find((node) => node.props.message === 'plugin.install.select_failed');
    expect(alert).toBeTruthy();
    view.unmount();
  });

  it('hides native pickers in the web runtime', () => {
    runtime.isWebRuntime.mockReturnValue(true);
    const view = create(<LocalInstallPanel allowed onInstalled={vi.fn()} />);
    expect(buttonByText(view, 'plugin.install.select_file')).toBeUndefined();
    expect(buttonByText(view, 'plugin.install.select_directory')).toBeUndefined();
    expect(buttonByText(view, 'plugin.install.inspect')).toBeTruthy();
    view.unmount();
  });
});
