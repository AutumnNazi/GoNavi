// @vitest-environment jsdom
import { Button, Slider, Alert } from 'antd';
import type { ChangeEvent } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundImageStore } from '../../backgroundImageStore';
import { I18nProvider } from '../../i18n/provider';
import { t } from '../../i18n';
import { BackgroundImageError, prepareBackgroundImage, type BackgroundImageErrorCode } from '../../utils/backgroundImage';
import BackgroundImageSettings from './BackgroundImageSettings';
import { ThemeModeSettingsSection } from '../../appShell/settings/ThemeModeSettingsSection';
import { PREFERENCES_SEARCH_ENTRIES } from './settingsSearchEntries/preferences';
import en from '../../../../shared/i18n/en-US.json';
import zh from '../../../../shared/i18n/zh-CN.json';
import tw from '../../../../shared/i18n/zh-TW.json';
import ja from '../../../../shared/i18n/ja-JP.json';
import de from '../../../../shared/i18n/de-DE.json';
import ru from '../../../../shared/i18n/ru-RU.json';

vi.mock('../../utils/backgroundImage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../utils/backgroundImage')>(),
  prepareBackgroundImage: vi.fn(),
}));

const image = { name: 'wallpaper.png', dataUrl: 'data:image/jpeg;base64,/9j//9k=' };
const file = () => new File(['image'], image.name, { type: 'image/png' });
let view: ReactTestRenderer;
const key = (suffix: string) => `app.theme.background.${suffix}`;
const button = (suffix: string) => view.root.findAllByType(Button)
  .find((node) => node.props.children === t(key(suffix), undefined, 'en-US'))!;
const mount = () => {
  act(() => {
    view = create(
      <I18nProvider preference="en-US" onPreferenceChange={() => undefined}>
        <BackgroundImageSettings />
      </I18nProvider>,
    );
  });
};
const select = (selected: File | null = file()) => {
  const input = { files: selected ? [selected] : [], value: selected?.name ?? '' };
  view.root.findByType('input').props.onChange({ currentTarget: input } as unknown as ChangeEvent<HTMLInputElement>);
  return input;
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(prepareBackgroundImage).mockReset().mockResolvedValue(image);
  useBackgroundImageStore.setState({ image: null, builtinId: null, enabled: false, opacity: 15, positionX: 0, positionY: 0, previewPosition: null });
});
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.restoreAllMocks();
});

describe('BackgroundImageSettings', () => {
  it('places an independent background section directly after custom themes', () => {
    const renderSection = vi.fn(() => <div />);
    ThemeModeSettingsSection({
      t: (value) => value,
      effectiveThemePreference: 'light',
      selectPresetTheme: vi.fn(),
      renderThemeModePreview: () => <div />,
      renderThemeSettingsSection: renderSection,
    });
    const calls = renderSection.mock.calls as unknown as [string, { type: unknown }][];
    const customIndex = calls.findIndex(([title]) => title === 'app.theme.custom.title');
    expect(calls[customIndex + 1][0]).toBe(key('title'));
    expect(calls[customIndex + 1][1].type).toBe(BackgroundImageSettings);
    expect(PREFERENCES_SEARCH_ENTRIES.some((entry) => entry.labelKey === key('title')
      && entry.group === 'preferences' && entry.item === 'theme-theme')).toBe(true);
  });

  it('provides matching keys and interpolation tokens in all six languages', () => {
    const keys = Object.keys(en).filter((entry) => entry.startsWith('app.theme.background.'));
    expect(keys).toHaveLength(62);
    expect(keys.filter(entry => entry.startsWith('app.theme.background.gallery.'))).toHaveLength(31);
    for (const catalog of [en, zh, tw, ja, de, ru]) {
      expect(Object.keys(catalog).filter((entry) => entry.startsWith('app.theme.background.')).sort())
        .toEqual([...keys].sort());
      for (const entry of keys) {
        const value = (catalog as Record<string, string>)[entry];
        expect(value.trim()).not.toBe('');
        expect(value.match(/\{\{\w+\}\}/g)).toEqual((en as Record<string, string>)[entry].match(/\{\{\w+\}\}/g));
      }
    }
  });

  it('imports the selected file, shows its preview and permits selecting the same file again', async () => {
    mount();
    const selected = file();
    await act(async () => { expect(select(selected).value).toBe(''); });
    expect(prepareBackgroundImage).toHaveBeenCalledWith(selected);
    expect(view.root.findByType('img').props.src).toBe(image.dataUrl);
    expect(view.root.findByType('img').props.alt).toBe(`Background image preview: ${image.name}`);
    expect(view.root.findByProps({ title: image.name }).children).toEqual([image.name]);
    expect(button('replace')).toBeDefined();
    await act(async () => { expect(select(selected).value).toBe(''); });
    expect(prepareBackgroundImage).toHaveBeenCalledTimes(2);
  });

  it('clears the input before opening the picker', () => {
    const input = { value: image.name, click: vi.fn() };
    act(() => {
      view = create(
        <I18nProvider preference="en-US" onPreferenceChange={() => undefined}>
          <BackgroundImageSettings />
        </I18nProvider>,
        { createNodeMock: (element) => element.type === 'input' ? input : null },
      );
    });
    act(() => button('upload').props.onClick());
    expect(input.value).toBe('');
    expect(input.click).toHaveBeenCalledOnce();
    expect(view.root.findByType('input').props.accept).toBe('image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp');
  });

  it('disables actions while importing and ignores concurrent selections', async () => {
    useBackgroundImageStore.setState({ image });
    let finish!: (value: typeof image) => void;
    vi.mocked(prepareBackgroundImage).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    mount();
    act(() => { select(); });
    expect(button('busy').props.loading).toBe(true);
    expect(view.root.findByProps({ className: 'gonavi-background-image-settings' }).props['aria-busy']).toBe(true);
    expect(view.root.findByType('input').props.disabled).toBe(true);
    expect(view.root.findAllByType(Button).every((node) => node.props.disabled)).toBe(true);
    expect(view.root.findAllByType(Slider).find((node) => node.props.min === 5)!.props.disabled).toBe(true);
    act(() => {
      select();
      button('remove').props.onClick();
      button('reset').props.onClick();
      view.root.findAllByType(Slider).find((node) => node.props.min === 5)!.props.onChange(30);
    });
    expect(prepareBackgroundImage).toHaveBeenCalledOnce();
    expect(useBackgroundImageStore.getState().image).toEqual(image);
    expect(useBackgroundImageStore.getState().opacity).toBe(15);
    await act(async () => { finish(image); });
    expect(button('replace').props.loading).toBe(false);
    expect(view.root.findAllByType(Slider).find((node) => node.props.min === 5)!.props.disabled).toBe(false);
  });

  it('does nothing when the picker is cancelled', async () => {
    mount();
    await act(async () => { expect(select(null).value).toBe(''); });
    expect(prepareBackgroundImage).not.toHaveBeenCalled();
    expect(button('upload').props.loading).toBe(false);
  });

  it.each<[BackgroundImageErrorCode, string]>([
    ['invalid-type', 'invalid_type'], ['too-large', 'too_large'],
    ['invalid-image', 'invalid_image'], ['storage-failed', 'storage_failed'],
  ])('translates %s errors, preserves the image and allows retrying', async (code, suffix) => {
    useBackgroundImageStore.setState({ image });
    vi.mocked(prepareBackgroundImage).mockRejectedValueOnce(new BackgroundImageError(code));
    mount();
    await act(async () => { select(); });
    expect(view.root.findByType(Alert).props.message).toBe(t(key(`error.${suffix}`), undefined, 'en-US'));
    expect(view.root.findByType(Alert).props.role).toBe('alert');
    expect(useBackgroundImageStore.getState().image).toEqual(image);
    expect(button('replace').props.loading).toBe(false);
    await act(async () => { select(); });
    expect(view.root.findAllByType(Alert)).toHaveLength(0);
  });

  it('uses a translated fallback instead of displaying an unknown exception', async () => {
    vi.mocked(prepareBackgroundImage).mockRejectedValue(new Error('private diagnostic'));
    mount();
    await act(async () => { select(); });
    expect(view.root.findByType(Alert).props.message).toBe(t(key('error.operation_failed'), undefined, 'en-US'));
  });

  it('removes the image without changing intensity', () => {
    useBackgroundImageStore.setState({ image, opacity: 25 });
    mount();
    act(() => button('remove').props.onClick());
    expect(useBackgroundImageStore.getState().image).toBeNull();
    expect(useBackgroundImageStore.getState().opacity).toBe(25);
    expect(view.root.findAllByType('img')).toHaveLength(0);
    expect(button('upload')).toBeDefined();
  });

  it('restores no image and the default 15 percent intensity', () => {
    useBackgroundImageStore.setState({ image, opacity: 30 });
    mount();
    act(() => button('reset').props.onClick());
    expect(useBackgroundImageStore.getState().image).toBeNull();
    expect(useBackgroundImageStore.getState().opacity).toBe(15);
    expect(button('reset').props.disabled).toBe(true);
  });

  it('uses a labelled 5–30 percent slider and updates its displayed intensity', () => {
    mount();
    const slider = view.root.findAllByType(Slider).find((node) => node.props.min === 5)!;
    expect(slider.props).toMatchObject({ min: 5, max: 30, step: 1, value: 15, ariaLabelForHandle: 'Background Intensity' });
    expect(slider.props.ariaValueTextFormatterForHandle(30)).toBe('30%');
    expect(slider.props.tooltip.formatter(5)).toBe('5%');
    act(() => slider.props.onChange(5));
    expect(useBackgroundImageStore.getState().opacity).toBe(5);
    expect(view.root.findByType('output').children).toEqual(['5%']);
    act(() => slider.props.onChange(30));
    expect(useBackgroundImageStore.getState().opacity).toBe(30);
    expect(view.root.findByType('output').children).toEqual(['30%']);
    act(() => button('reset').props.onClick());
    expect(useBackgroundImageStore.getState().opacity).toBe(15);
  });

  it.each(['remove', 'reset', 'slider'])('shows storage errors from %s without losing the existing settings', (action) => {
    useBackgroundImageStore.setState({ image, opacity: 20 });
    mount();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => {
      if (action === 'slider') view.root.findAllByType(Slider).find((node) => node.props.min === 5)!.props.onChange(25);
      else button(action).props.onClick();
    });
    expect(view.root.findByType(Alert).props.message).toBe(t(key('error.storage_failed'), undefined, 'en-US'));
    expect(useBackgroundImageStore.getState().image).toEqual(image);
    expect(useBackgroundImageStore.getState().opacity).toBe(20);
  });
});
