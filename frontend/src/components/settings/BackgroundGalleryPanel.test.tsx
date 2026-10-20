// @vitest-environment jsdom
import { Alert, Button, Progress } from 'antd';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/provider';
import { useBackgroundImageStore as store } from '../../backgroundImageStore';
import { galleryEntry, galleryInstalled } from '../../backgroundGallery/testFixtures';
import BuiltinBackgroundSettings from './BuiltinBackgroundSettings';
import BackgroundGalleryCard from './BackgroundGalleryCard';
const adapter = vi.hoisted(() => ({ status: vi.fn(), refresh: vi.fn(), resolve: vi.fn(), download: vi.fn(), cancel: vi.fn(), remove: vi.fn(), thumbnail: vi.fn() }));
vi.mock('../../backgroundGallery/adapter', () => ({ getGalleryAdapter: async () => adapter }));
let view: ReactTestRenderer;
const click = async (className: string) => { await act(async () => view.root.findAllByType(Button).find(node => node.props.className === className)!.props.onClick()); };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); store.getState().reload();
  const state = { catalog: { schemaVersion: 1, version: '1', entries: [galleryEntry()] }, installed: [], stale: false };
  adapter.status.mockResolvedValue(state); adapter.refresh.mockResolvedValue(state);
  adapter.resolve.mockRejectedValue({ code: 'unavailable' }); adapter.download.mockResolvedValue(galleryInstalled()); adapter.cancel.mockResolvedValue(undefined);
});
afterEach(() => { act(() => view?.unmount()); vi.restoreAllMocks(); });
const mount = async () => { await act(async () => { view = create(<I18nProvider preference="en-US" onPreferenceChange={() => undefined}>
  <BuiltinBackgroundSettings disabled={false} runAction={action => action()} />
</I18nProvider>); }); };

describe('explicit background gallery opening', () => {
  const newer = () => { const value = galleryInstalled(); value.entry.version = '2'; return value; };
  const historyState = () => ({ catalog: { schemaVersion: 1, version: '2', entries: [newer().entry] }, installed: [galleryInstalled()], stale: false });
  const cardVersion = (version: string) => view.root.findAllByType(BackgroundGalleryCard).find(node => node.props.entry.version === version)!;
  it('keeps an installed older version selectable offline after a catalog update', async () => {
    const state = historyState(); adapter.status.mockResolvedValue(state);
    adapter.refresh.mockRejectedValue({ code: 'download_failed' }); adapter.resolve.mockResolvedValue(galleryInstalled());
    await mount(); await click('gonavi-gallery-toggle');
    expect(view.root.findAllByType(BackgroundGalleryCard)).toHaveLength(2);
    await act(async () => cardVersion('1').props.onSelect());
    expect(adapter.resolve).toHaveBeenCalledWith('whale-maid-a', '1');
    expect(view.root.findAllByType(BackgroundGalleryCard).every(node => node.props.showVersion)).toBe(true);
    expect(store.getState().builtinVersion).toBe('1'); expect(adapter.download).not.toHaveBeenCalled();
  });
  it('removes an old version without removing the selected newer version of the same artwork', async () => {
    const current = newer(); const state = historyState(); state.installed.push(current);
    adapter.status.mockResolvedValue(state); adapter.refresh.mockResolvedValue(state); adapter.resolve.mockResolvedValue(current);
    await store.getState().selectBuiltin(current.entry.id, current.entry.version);
    await mount(); await click('gonavi-gallery-toggle');
    expect(view.root.findAllByType(BackgroundGalleryCard)).toHaveLength(2);
    await act(async () => cardVersion('1').props.onRemove());
    expect(adapter.remove).toHaveBeenCalledWith(current.entry.id, '1');
    adapter.remove.mockClear(); await act(async () => cardVersion('2').props.onRemove());
    expect(adapter.remove).not.toHaveBeenCalled(); expect(store.getState().builtinVersion).toBe('2');
  });
  it('marks only the requested version pending when multiple versions are visible', async () => {
    const state = historyState(); adapter.status.mockResolvedValue(state); adapter.refresh.mockResolvedValue(state);
    let finish!: (value: ReturnType<typeof galleryInstalled>) => void;
    adapter.download.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await click('gonavi-gallery-toggle');
    expect(view.root.findAllByType(BackgroundGalleryCard)).toHaveLength(2);
    await act(async () => cardVersion('2').props.onSelect());
    expect(cardVersion('2').props.pending).toBe(true); expect(cardVersion('1').props.pending).toBe(false);
    await click('gonavi-gallery-cancel'); await act(async () => finish(newer()));
  });
  it('does not refresh or fetch images until opened, then refreshes without downloading raw images', async () => {
    await mount();
    expect(adapter.refresh).not.toHaveBeenCalled(); expect(adapter.thumbnail).not.toHaveBeenCalled(); expect(adapter.download).not.toHaveBeenCalled();
    await click('gonavi-gallery-toggle');
    expect(adapter.refresh).toHaveBeenCalledTimes(1); expect(adapter.download).not.toHaveBeenCalled();
    expect(adapter.thumbnail).not.toHaveBeenCalled();
    expect(view.root.findAllByProps({ className: 'gonavi-gallery-card' })).toHaveLength(1);
  });
  it('shows progress, cancels explicitly, and ignores a late durable result', async () => {
    let finish!: (value: unknown) => void;
    adapter.download.mockImplementation((_id, _version, requestId, onProgress) => {
      onProgress({ requestId, downloaded: 30, total: 60, phase: 'downloading' });
      return new Promise(resolve => { finish = resolve; });
    });
    await mount(); await click('gonavi-gallery-toggle');
    await click('gonavi-builtin-background-option');
    expect(view.root.findByType(Progress).props.percent).toBe(50);
    expect(store.getState().builtinId).toBeNull();
    await click('gonavi-gallery-cancel');
    expect(adapter.cancel).toHaveBeenCalledTimes(1);
    await act(async () => { finish(galleryInstalled()); });
    expect(store.getState().builtinId).toBeNull();
    expect(view.root.findAllByType(Progress)).toHaveLength(0);
  });
  it.each(['close', 'unmount'])('invalidates a pending selection on %s', async action => {
    let finish!: (value: unknown) => void;
    adapter.download.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await mount(); await click('gonavi-gallery-toggle'); await click('gonavi-builtin-background-option');
    if (action === 'close') await click('gonavi-gallery-toggle'); else act(() => view.unmount());
    expect(adapter.cancel).toHaveBeenCalledTimes(1);
    await act(async () => { finish(galleryInstalled()); });
    expect(store.getState().builtinId).toBeNull();
  });
  it('keeps the old background and offers retry after a failed download', async () => {
    adapter.resolve.mockResolvedValueOnce(galleryInstalled('whale-maid-b'));
    await store.getState().selectBuiltin('whale-maid-b', '1');
    adapter.download.mockRejectedValueOnce({ code: 'integrity' });
    await mount(); await click('gonavi-gallery-toggle'); await click('gonavi-builtin-background-option');
    expect(store.getState().builtinId).toBe('whale-maid-b');
    expect(view.root.findAllByType(Alert).some(node => node.props.type === 'error')).toBe(true);
    adapter.download.mockResolvedValueOnce(galleryInstalled());
    await click('gonavi-builtin-background-option'); expect(store.getState().builtinId).toBe('whale-maid-a');
  });
  it('retains locally saved cards when catalog refresh fails offline', async () => {
    adapter.refresh.mockRejectedValueOnce({ code: 'download_failed' });
    await mount(); await click('gonavi-gallery-toggle');
    expect(view.root.findAllByProps({ className: 'gonavi-gallery-card' })).toHaveLength(1);
    expect(view.root.findAllByType('pre').map(node => node.props.children)).toEqual([galleryEntry().license.notice, galleryEntry().license.text]);
    expect(view.root.findAllByType(Alert)).toHaveLength(1);
  });
});
