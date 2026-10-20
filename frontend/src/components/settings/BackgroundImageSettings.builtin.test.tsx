// @vitest-environment jsdom
import { Alert, Button, Slider, Switch } from 'antd';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundImageStore as store } from '../../backgroundImageStore';
import { I18nProvider } from '../../i18n/provider';
import { galleryInstalled } from '../../backgroundGallery/testFixtures';
import { prepareBackgroundImage } from '../../utils/backgroundImage';
import BackgroundImageSettings from './BackgroundImageSettings';
import BackgroundImageStyleHost from '../theme/BackgroundImageStyleHost';
const adapter = vi.hoisted(() => ({ status: vi.fn(), refresh: vi.fn(), resolve: vi.fn(), cancel: vi.fn(), thumbnail: vi.fn() }));
vi.mock('../../backgroundGallery/adapter', () => ({ getGalleryAdapter: async () => adapter }));
vi.mock('../../utils/backgroundImage', async original => ({
  ...await original<typeof import('../../utils/backgroundImage')>(), prepareBackgroundImage: vi.fn(),
}));
let view: ReactTestRenderer;
let root: HTMLElement;
const installed = [galleryInstalled(), galleryInstalled('whale-maid-b')];
const builtinButton = (index: number) => view.root.findAllByType(Button).filter(button => button.props.className === 'gonavi-builtin-background-option')[index];
const toggle = () => view.root.findByType(Switch);
const mount = async (open = false) => {
  await act(async () => { view = create(<I18nProvider preference="en-US" onPreferenceChange={() => undefined}>
    <BackgroundImageStyleHost /><BackgroundImageSettings />
  </I18nProvider>); });
  if (open) await act(async () => view.root.findAllByType(Button).find(node => node.props.className === 'gonavi-gallery-toggle')!.props.onClick());
};
beforeEach(() => {
  localStorage.clear(); store.getState().reload(); vi.clearAllMocks();
  const state = { catalog: { schemaVersion: 1, version: '1', entries: installed.map(value => value.entry) }, installed, stale: false };
  adapter.status.mockResolvedValue(state); adapter.refresh.mockResolvedValue(state);
  adapter.resolve.mockImplementation(async id => installed.find(value => value.entry.id === id)); adapter.cancel.mockResolvedValue(undefined);
  root = document.createElement('main'); root.className = 'gn-v2-app-root'; document.body.append(root);
});
afterEach(() => { act(() => view?.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('remote background settings and style integration', () => {
  it('starts unchecked with no implicit image requests and explains opt-in behavior', async () => {
    await mount();
    expect(toggle().props).toMatchObject({ checked: false, disabled: true });
    expect(adapter.refresh).not.toHaveBeenCalled(); expect(adapter.thumbnail).not.toHaveBeenCalled();
    expect(JSON.stringify(view.toJSON())).toContain('Off by default');
    expect(root.hasAttribute('data-background-image')).toBe(false);
    await act(async () => view.root.findAllByType(Button).find(node => node.props.className === 'gonavi-gallery-toggle')!.props.onClick());
    expect(builtinButton(0).props['aria-pressed']).toBe(false); expect(builtinButton(1).props['aria-pressed']).toBe(false);
  });
  it.each([0, 1])('selects downloaded entry %s explicitly, previews contain, persists ID and restores after disable', async index => {
    await mount(true);
    await act(async () => builtinButton(index).props.onClick());
    const selected = installed[index];
    expect(store.getState()).toMatchObject({ builtinId: selected.entry.id, builtinVersion: '1', enabled: true, image: null });
    expect(builtinButton(index).props['aria-pressed']).toBe(true);
    expect(view.root.findByType('img').props).toMatchObject({ src: selected.url, style: { objectFit: 'contain' } });
    expect(root.style.getPropertyValue('--gn-background-size')).toBe('contain');
    expect(root.style.getPropertyValue('--gn-background-image')).toBe('url("' + selected.url + '")');
    const axes = view.root.findAllByType(Slider).filter(slider => slider.props.min === -100);
    act(() => axes[0].props.onChange(12));
    expect(root.style.getPropertyValue('--gn-background-offset-x')).toBe('12vw');
    act(() => axes[0].props.onChangeComplete());
    act(() => view.root.findAllByType(Slider).find(slider => slider.props.min === 5)!.props.onChange(25));
    expect(root.style.getPropertyValue('--gn-background-tint')).toBe('75%');
    act(() => toggle().props.onChange(false));
    expect(root.hasAttribute('data-background-image')).toBe(false);
    for (const property of ['image', 'size', 'tint', 'offset-x', 'offset-y']) expect(root.style.getPropertyValue('--gn-background-' + property)).toBe('');
    expect(view.root.findByType('img').props.src).toBe(selected.url);
    await act(async () => store.getState().reload());
    expect(toggle().props.checked).toBe(false);
    await act(async () => toggle().props.onChange(true));
    expect(root.style.getPropertyValue('--gn-background-offset-x')).toBe('12vw');
    expect(root.style.getPropertyValue('--gn-background-tint')).toBe('75%');
    expect(adapter.refresh).toHaveBeenCalledTimes(1);
  });
  it('leaves migrated uploads disabled while retaining the editable preview', async () => {
    localStorage.setItem('gonavi-background-image-v1', JSON.stringify({ version: 1, image: { name: 'legacy.jpg', dataUrl: 'data:image/jpeg;base64,/9j//9k=' }, opacity: 24 }));
    store.getState().reload(); await mount();
    expect(toggle().props).toMatchObject({ checked: false, disabled: false });
    expect(view.root.findByType('img').props.style.objectFit).toBe('cover');
    expect(root.hasAttribute('data-background-image')).toBe(false);
    act(() => toggle().props.onChange(true)); expect(root.style.getPropertyValue('--gn-background-size')).toBe('cover');
  });
  it('replaces a gallery entry with a safely prepared upload and enables the cover preview', async () => {
    await store.getState().selectBuiltin('whale-maid-a'); store.getState().setEnabled(false);
    const image = { name: 'new.jpg', dataUrl: 'data:image/jpeg;base64,/9j//9k=' };
    vi.mocked(prepareBackgroundImage).mockResolvedValue(image); await mount();
    const file = new File(['image'], image.name, { type: 'image/jpeg' });
    await act(async () => view.root.findByType('input').props.onChange({ currentTarget: { files: [file], value: '' } }));
    expect(prepareBackgroundImage).toHaveBeenCalledWith(file);
    expect(store.getState()).toMatchObject({ enabled: true, builtinId: null, image });
    expect(root.style.getPropertyValue('--gn-background-size')).toBe('cover');
  });
  it.each(['select', 'toggle'])('reports %s storage failure without losing the selected background', async action => {
    await store.getState().selectBuiltin('whale-maid-a'); await mount(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await act(async () => action === 'select' ? builtinButton(1).props.onClick() : toggle().props.onChange(false));
    expect(store.getState()).toMatchObject({ enabled: true, builtinId: 'whale-maid-a' });
    expect(view.root.findAllByType(Alert).some(node => node.props.type === 'error')).toBe(true);
    expect(root.style.getPropertyValue('--gn-background-image')).toBe('url("' + installed[0].url + '")');
  });
  it('provides selected-entry attribution, full offline license and public links without refreshing', async () => {
    await store.getState().selectBuiltin('whale-maid-b'); await mount();
    const entry = installed[1].entry;
    expect(view.root.findAllByType('a').map(link => link.props.href)).toEqual([entry.sourceUrl, entry.license.url]);
    expect(view.root.findAllByType('pre').map(node => node.props.children)).toEqual([entry.license.notice, entry.license.text]);
    expect(JSON.stringify(view.toJSON())).toContain(entry.attribution); expect(adapter.refresh).not.toHaveBeenCalled();
  });
});
