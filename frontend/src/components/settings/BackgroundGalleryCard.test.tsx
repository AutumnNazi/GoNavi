// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/provider';
import { galleryEntry } from '../../backgroundGallery/testFixtures';
import BackgroundGalleryCard from './BackgroundGalleryCard';
const adapter = vi.hoisted(() => ({ thumbnail: vi.fn(), download: vi.fn() }));
vi.mock('../../backgroundGallery/adapter', () => ({ getGalleryAdapter: async () => adapter }));
let view: ReactTestRenderer;
let visible: (changes: { isIntersecting: boolean }[]) => void;
const disconnect = vi.fn(); const observe = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof visible) { visible = callback; } observe = observe; disconnect = disconnect; });
  adapter.thumbnail.mockResolvedValue('blob:thumbnail-fixture');
});
afterEach(() => { act(() => view?.unmount()); vi.unstubAllGlobals(); });
const mount = async () => { await act(async () => { view = create(<I18nProvider preference="en-US" onPreferenceChange={() => undefined}>
  <BackgroundGalleryCard entry={galleryEntry()} downloaded={false} selected={false} pending={false} failed={false} disabled={false}
    progress={null} onSelect={() => undefined} onCancel={() => undefined} onRemove={() => undefined} />
</I18nProvider>, { createNodeMock: element => element.props.className === 'gonavi-gallery-thumbnail' ? document.createElement('div') : null }); }); };
describe('gallery thumbnail visibility boundary', () => {
  it('fetches a verified thumbnail only when visible, never fetching full images', async () => {
    await mount(); expect(observe).toHaveBeenCalled(); expect(adapter.thumbnail).not.toHaveBeenCalled();
    await act(async () => visible([{ isIntersecting: false }])); expect(adapter.thumbnail).not.toHaveBeenCalled();
    await act(async () => visible([{ isIntersecting: true }]));
    expect(adapter.thumbnail).toHaveBeenCalledTimes(1); expect(adapter.thumbnail.mock.calls[0][0]).toEqual(galleryEntry());
    expect(view.root.findByType('img').props.src).toBe('blob:thumbnail-fixture'); expect(adapter.download).not.toHaveBeenCalled();
    await act(async () => visible([{ isIntersecting: true }])); expect(adapter.thumbnail).toHaveBeenCalledTimes(1);
    const signal = adapter.thumbnail.mock.calls[0][1] as AbortSignal;
    act(() => view.unmount()); expect(signal.aborted).toBe(true); expect(disconnect).toHaveBeenCalled();
  });
  it('ignores a thumbnail that completes after card unmount', async () => {
    let finish!: (url: string) => void;
    adapter.thumbnail.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await mount(); await act(async () => visible([{ isIntersecting: true }]));
    act(() => view.unmount()); await act(async () => { finish('blob:late'); });
    expect(view.toJSON()).toBeNull();
  });
});
