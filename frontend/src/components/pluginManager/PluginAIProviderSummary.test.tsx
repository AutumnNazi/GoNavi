import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '../../plugins/types';
vi.mock('antd', () => {
  const element = (name: string) => (props: React.HTMLAttributes<HTMLElement>) => React.createElement('div', { ...props, 'data-component': name });
  return { Tag: element('tag'), Typography: { Text: element('text') } };
});
vi.mock('../../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { PluginAIProviderSummary } from './PluginAIProviderSummary';
const manifest: PluginManifest = { schemaVersion: 1, apiVersion: 1, id: 'example.ai', name: 'AI', version: '1', permissions: ['ai.providers'],
  contributes: { aiProviders: [{ id: 'chat', name: 'Chat', command: 'generate', supportsTools: true, supportsImages: false, models: [{ id: 'model', name: 'Model', contextWindow: 4096, maxOutputTokens: 512 }] }] } };
describe('installed ai provider summary', () => {
  it('shows the declared model and that images are unsupported', () => {
    const view = create(<PluginAIProviderSummary manifest={manifest} />);
    expect(view.root.findAllByType('code').map((node) => node.children.join('')).join(' ')).toContain('chat');
    expect(view.root.findAllByProps({ 'data-component': 'tag' }).map((tag) => String(tag.children))).toContain('plugin.ai_provider.no_images');
    view.unmount();
    const imageView = create(<PluginAIProviderSummary manifest={{ ...manifest, contributes: { aiProviders: [{ ...manifest.contributes!.aiProviders![0], supportsImages: true }] } }} />);
    expect(imageView.root.findAllByProps({ 'data-component': 'tag' }).map((tag) => String(tag.children))).toContain('plugin.ai_provider.images_supported');
    imageView.unmount();
    const empty = create(<PluginAIProviderSummary manifest={{ ...manifest, contributes: undefined }} />);
    expect(empty.toJSON()).toBeNull();
    empty.unmount();
  });
});
