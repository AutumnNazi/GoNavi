import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ PluginMarketSettings: vi.fn(), PluginMarketConfigure: vi.fn(), PluginMarketCatalog: vi.fn(),
  PluginMarketDetail: vi.fn(), PluginMarketRatings: vi.fn(), PluginMarketRate: vi.fn(), PluginMarketDeleteRating: vi.fn(),
  PluginMarketLogin: vi.fn(), PluginMarketPollLogin: vi.fn(), PluginMarketLogout: vi.fn(), PluginMarketInstall: vi.fn(),
  PluginMarketInspect: vi.fn(), PluginMarketCancelInspection: vi.fn(), PluginMarketSubmit: vi.fn() }));
vi.mock('../../wailsjs/go/app/App', () => host);
vi.mock('../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('antd', () => {
  const element = (name: string) => (props: React.HTMLAttributes<HTMLElement>) => React.createElement('div', { ...props, 'data-component': name });
  return { Alert: element('alert'), Button: element('button'), Input: element('input'), Modal: element('modal'), Space: element('space'),
    Typography: { Text: element('text'), Paragraph: element('paragraph') } };
});
const picker = vi.hoisted(() => ({ pickPluginPackageFile: vi.fn() }));
vi.mock('../components/pluginManager/pluginPackagePicker', () => picker);
import { MarketPublishModal } from './MarketPublishModal';
const ok = (data: unknown) => ({ success: true, data });
let renderer: ReturnType<typeof create> | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.resetAllMocks(); });
const buttons = () => renderer!.root.findAllByProps({ 'data-component': 'button' });
const buttonByText = (text: string) => buttons().find((button) => button.children.includes(text))!;

describe('market self-service publish modal', () => {
  it('keeps submit disabled until a package is picked', async () => {
    picker.pickPluginPackageFile.mockResolvedValue({ status: 'canceled' });
    await act(async () => { renderer = create(<MarketPublishModal open onClose={vi.fn()} />); });
    expect(buttonByText('plugin.market.publish_submit').props.disabled).toBe(true);
    expect(host.PluginMarketSubmit).not.toHaveBeenCalled();
  });

  it('uploads the picked archive once and shows the published state', async () => {
    picker.pickPluginPackageFile.mockResolvedValue({ status: 'selected', path: 'D:\\build\\tool-1.0.0.zip' });
    host.PluginMarketSubmit.mockResolvedValue(ok({ id: 's1', pluginId: 'gh-author.tool', version: '1.0.0', state: 'published', publisherId: 'gh-author' }));
    const published = vi.fn();
    await act(async () => { renderer = create(<MarketPublishModal open onClose={vi.fn()} published={published} />); });
    await act(async () => { await buttonByText('plugin.market.publish_pick').props.onClick(); });
    expect(buttonByText('plugin.market.publish_submit').props.disabled).toBe(false);
    await act(async () => { await buttonByText('plugin.market.publish_submit').props.onClick(); });
    expect(host.PluginMarketSubmit).toHaveBeenCalledWith('D:\\build\\tool-1.0.0.zip', '');
    expect(published).toHaveBeenCalledOnce();
    const alerts = renderer!.root.findAllByProps({ 'data-component': 'alert' });
    const success = alerts.find((alert) => alert.props.type === 'success');
    expect(success).toBeTruthy();
    expect(String(success!.props.description?.props?.className)).toBe('plugin-publish-result');
    expect(String(success!.props.message)).toBe('plugin.market.publish_success');
  });

  it('surfaces a structured submission failure without losing the picked path', async () => {
    picker.pickPluginPackageFile.mockResolvedValue({ status: 'selected', path: '/tmp/tool-2.0.0.tgz' });
    host.PluginMarketSubmit.mockResolvedValue({ success: false, data: { code: 'artifact_invalid' }, message: '' });
    await act(async () => { renderer = create(<MarketPublishModal open onClose={vi.fn()} />); });
    await act(async () => { await buttonByText('plugin.market.publish_pick').props.onClick(); });
    await act(async () => { await buttonByText('plugin.market.publish_submit').props.onClick(); });
    const alerts = renderer!.root.findAllByProps({ 'data-component': 'alert' });
    expect(alerts.some((alert) => alert.props.type === 'error')).toBe(true);
    expect(buttonByText('plugin.market.publish_submit').props.disabled).toBe(false);
  });
});
