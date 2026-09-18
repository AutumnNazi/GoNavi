import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/provider';
import ReproductionBundlePanel from './ReproductionBundlePanel';

vi.mock('../../i18n/runtime', () => ({
  syncLanguageRuntime: vi.fn(async () => undefined),
}));

vi.mock('antd', () => {
  const Descriptions: any = ({ children }: any) => <dl>{children}</dl>;
  Descriptions.Item = ({ children }: any) => <dd>{children}</dd>;
  return {
    Alert: ({ message: text }: any) => <div>{text}</div>,
    Button: ({ children, onClick }: any) => <button type="button" onClick={onClick}>{children}</button>,
    Descriptions,
    Empty: ({ description }: any) => <div>{description}</div>,
    Modal: ({ open, children, onCancel, onOk }: any) => open ? (
      <div data-modal="reproduction-preview">
        {children}
        <button type="button" data-action="cancel" onClick={onCancel}>取消</button>
        <button type="button" data-action="replay" onClick={onOk}>回放</button>
      </div>
    ) : null,
    Space: ({ children }: any) => <div>{children}</div>,
    Table: ({ dataSource = [], columns = [], rowKey }: any) => (
      <div>{dataSource.map((row: any) => (
        <div key={rowKey(row)}>{columns.map((column: any) => column.render?.(row[column.dataIndex], row) || row[column.dataIndex])}</div>
      ))}</div>
    ),
    Tag: ({ children }: any) => <span>{children}</span>,
    Typography: {
      Text: ({ children }: any) => <span>{children}</span>,
      Title: ({ children }: any) => <h2>{children}</h2>,
    },
    message: { error: vi.fn(), success: vi.fn() },
  };
});

const renderPanel = async (
  backend: React.ComponentProps<typeof ReproductionBundlePanel>['backend'],
  preference: 'zh-CN' | 'en-US' = 'zh-CN',
  withProvider = true,
): Promise<ReactTestRenderer> => {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      withProvider ? (
        <I18nProvider preference={preference} systemLanguages={[]} onPreferenceChange={() => {}}>
          <ReproductionBundlePanel isActive backend={backend} />
        </I18nProvider>
      ) : (
        <ReproductionBundlePanel isActive backend={backend} />
      ),
    );
  });
  return renderer!;
};

describe('ReproductionBundlePanel', () => {
  it('previews the redaction manifest and cancel does not replay', async () => {
    const preview = vi.fn(async () => ({
      success: true,
      data: {
        appVersion: '0.9.3',
        source: { kind: 'query' as const, id: 'source-safe' },
        eventCount: 2,
        fixtureEngine: 'gonavi-fake-v1',
        offlineOnly: true,
        redaction: { credentials: 'excluded', sqlLiterals: 'removed' },
      },
    }));
    const replay = vi.fn(async () => ({ success: true, data: { reproduced: true, sourceKind: 'query' as const } }));
    const renderer = await renderPanel({
      ListReproductionBundleSources: vi.fn(async () => ({ success: true, data: { items: [], warnings: [] } })),
      PreviewReproductionBundle: preview,
      ReplayReproductionBundle: replay,
    });

    const input = renderer.root.findByProps({ 'aria-label': '选择最小复现包' });
    await act(async () => {
      await input.props.onChange({
        target: { files: [{ text: async () => '{"safe":true}' }] },
      });
    });
    expect(preview).toHaveBeenCalledWith('{"safe":true}');
    const cancel = renderer.root.findByProps({ 'data-action': 'cancel' });
    await act(async () => cancel.props.onClick());
    expect(replay).not.toHaveBeenCalled();
  });

  it('runs the fake fixture only after explicit confirmation', async () => {
    const replay = vi.fn(async () => ({ success: true, data: { reproduced: true, sourceKind: 'mcp' as const, errorKind: 'tool' } }));
    const renderer = await renderPanel({
      ListReproductionBundleSources: vi.fn(async () => ({ success: true, data: { items: [], warnings: [] } })),
      PreviewReproductionBundle: vi.fn(async () => ({
        success: true,
        data: { source: { kind: 'mcp' as const, id: 'source-safe' }, offlineOnly: true, fixtureEngine: 'gonavi-fake-v1' },
      })),
      ReplayReproductionBundle: replay,
    });

    const input = renderer.root.findByProps({ 'aria-label': '选择最小复现包' });
    await act(async () => {
      await input.props.onChange({ target: { files: [{ text: async () => '{"fixture":true}' }] } });
    });
    const confirm = renderer.root.findByProps({ 'data-action': 'replay' });
    await act(async () => confirm.props.onClick());
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith('{"fixture":true}');
  });

  it('renders English chrome when the app language is English', async () => {
    const renderer = await renderPanel({
      ListReproductionBundleSources: vi.fn(async () => ({ success: true, data: { items: [], warnings: [] } })),
      PreviewReproductionBundle: vi.fn(async () => ({
        success: true,
        data: {
          appVersion: '0.9.3',
          source: { kind: 'query' as const, id: 'source-safe' },
          eventCount: 2,
          fixtureEngine: 'gonavi-fake-v1',
          offlineOnly: true,
        },
      })),
      ReplayReproductionBundle: vi.fn(async () => ({ success: true, data: { reproduced: true, sourceKind: 'query' as const } })),
    }, 'en-US');

    const pageText = JSON.stringify(renderer.toJSON());
    expect(pageText).toContain('Minimal Reproduction Bundles');
    expect(pageText).toContain('Refresh failed tasks');
    expect(pageText).toContain('Import bundle');
    expect(pageText).toContain('Choose a minimal reproduction bundle');
    expect(pageText).not.toContain('失败任务最小复现包');

    const input = renderer.root.findByProps({ 'aria-label': 'Choose a minimal reproduction bundle' });
    await act(async () => {
      await input.props.onChange({ target: { files: [{ text: async () => '{"safe":true}' }] } });
    });
    const modalText = JSON.stringify(renderer.toJSON());
    expect(modalText).toContain('Offline replay only');
    expect(modalText).toContain('Query');
    expect(modalText).toContain('Security capability summary');
    expect(modalText).toContain('Redaction manifest');
    expect(modalText).not.toContain('查询');
    expect(modalText).not.toContain('仅离线回放');
  });

  it('falls back to the English catalog when no i18n provider is mounted', async () => {
    const renderer = await renderPanel({
      ListReproductionBundleSources: vi.fn(async () => ({ success: true, data: { items: [], warnings: [] } })),
    }, 'en-US', false);

    const pageText = JSON.stringify(renderer.toJSON());
    expect(pageText).toContain('Minimal Reproduction Bundles');
    expect(pageText).not.toContain('失败任务最小复现包');
  });
});
