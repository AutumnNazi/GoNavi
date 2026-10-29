import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ PluginIcon: vi.fn() }));
vi.mock('../../../wailsjs/go/app/App', () => host);
import { PluginLogo } from './PluginLogo';

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => { host.PluginIcon.mockReset(); });

describe('plugin logo', () => {
  it('renders the host-provided raster data URL', async () => {
    host.PluginIcon.mockResolvedValue('data:image/png;base64,AAAA');
    let view: ReturnType<typeof create> | undefined;
    await act(async () => { view = create(<PluginLogo pluginId="test.one" name="MongoShell" version="1.0.0" />); });
    await flush();
    const image = view!.root.findByType('img');
    expect(image.props.src).toBe('data:image/png;base64,AAAA');
    expect(image.props.alt).toBe('');
    view!.unmount();
  });

  it('falls back to the name monogram when no logo is declared', async () => {
    host.PluginIcon.mockResolvedValue('');
    let view: ReturnType<typeof create> | undefined;
    await act(async () => { view = create(<PluginLogo pluginId="test.two" name="華龍算力" version="1.0.0" />); });
    await flush();
    expect(view!.root.findByProps({ className: 'plugin-logo-monogram' }).props.children).toBe('華');
    expect(view!.root.findAllByType('img')).toHaveLength(0);
    view!.unmount();
  });

  it('keeps the monogram when the host call fails', async () => {
    host.PluginIcon.mockRejectedValue(new Error('runtime unavailable'));
    let view: ReturnType<typeof create> | undefined;
    await act(async () => { view = create(<PluginLogo pluginId="test.three" name="shell" version="1.0.0" />); });
    await flush();
    expect(view!.root.findByProps({ className: 'plugin-logo-monogram' }).props.children).toBe('S');
    view!.unmount();
  });

  it('reuses the cached logo across mounts', async () => {
    host.PluginIcon.mockResolvedValue('data:image/png;base64,BBBB');
    let view: ReturnType<typeof create> | undefined;
    await act(async () => { view = create(<PluginLogo pluginId="test.cache" name="Cached" version="1.0.0" />); });
    await flush();
    view!.unmount();
    await act(async () => { view = create(<PluginLogo pluginId="test.cache" name="Cached" version="1.0.0" />); });
    await flush();
    expect(view!.root.findByType('img').props.src).toBe('data:image/png;base64,BBBB');
    expect(host.PluginIcon).toHaveBeenCalledTimes(1);
    view!.unmount();
  });
});
