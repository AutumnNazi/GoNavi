import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import { I18nProvider } from '../../i18n/provider';
import { useStore, type AppearanceSettings } from '../../store';
import { DEFAULT_APPEARANCE } from '../../store/storeConstants';
import { routePreferenceSearchEntry } from '../../components/settings/preferences/preferenceSearchRouting';
import { TabAppearanceSettingsSection } from './TabAppearanceSettingsSection';

const en = (key: string) => t(key, undefined, 'en-US');

const mount = (): ReactTestRenderer => {
  let view!: ReactTestRenderer;
  act(() => {
    view = create(
      <I18nProvider preference="en-US" onPreferenceChange={() => undefined}>
        <TabAppearanceSettingsSection />
      </I18nProvider>,
    );
  });
  return view;
};

const pills = (view: ReactTestRenderer, attribute: string): ReactTestInstance[] =>
  view.root.findAll((node) => node.type === 'button' && typeof node.props[attribute] === 'string');

const pill = (view: ReactTestRenderer, attribute: string, value: string): ReactTestInstance => {
  const found = pills(view, attribute).find((node) => node.props[attribute] === value);
  if (!found) throw new Error(`missing pill ${attribute}=${value}`);
  return found;
};

const pillLabels = (nodes: ReactTestInstance[]) => nodes.map((node) => node.children.join(''));

const isSelected = (view: ReactTestRenderer, attribute: string, value: string) =>
  pill(view, attribute, value).props['aria-pressed'];

beforeEach(() => {
  useStore.setState({ appearance: { ...DEFAULT_APPEARANCE } });
});

describe('tab appearance settings section', () => {
  it('renders the section copy and both option groups from i18n', () => {
    const view = mount();
    const section = view.root.findByProps({ 'data-tab-appearance-settings': 'true' });

    expect(section.findByProps({ className: 'gonavi-settings-section-title' }).children.join(''))
      .toBe(en('app.theme.tab_appearance.title'));
    expect(section.findByProps({ className: 'gonavi-settings-section-hint' }).children.join(''))
      .toBe(en('app.theme.tab_appearance.description'));
    expect(section.findByProps({ 'aria-label': en('app.theme.tab_appearance.style.label') })).toBeTruthy();
    expect(section.findByProps({ 'aria-label': en('app.theme.tab_appearance.close_position.label') })).toBeTruthy();
    expect(pillLabels(pills(view, 'data-tab-appearance-style'))).toEqual([
      en('app.theme.tab_appearance.style.card'),
      en('app.theme.tab_appearance.style.underline'),
      en('app.theme.tab_appearance.style.pill'),
    ]);
    expect(pillLabels(pills(view, 'data-tab-close-position'))).toEqual([
      en('app.theme.tab_appearance.close_position.left'),
      en('app.theme.tab_appearance.close_position.right'),
    ]);
    expect(isSelected(view, 'data-tab-appearance-style', 'card')).toBe(true);
    expect(isSelected(view, 'data-tab-close-position', 'right')).toBe(true);

    act(() => view.unmount());
  });

  it('writes the picked tab style into appearance', () => {
    const view = mount();

    act(() => pill(view, 'data-tab-appearance-style', 'underline').props.onClick());

    expect(useStore.getState().appearance.tabAppearanceStyle).toBe('underline');
    expect(isSelected(view, 'data-tab-appearance-style', 'underline')).toBe(true);
    expect(isSelected(view, 'data-tab-appearance-style', 'card')).toBe(false);

    act(() => view.unmount());
  });

  it('writes the picked close button position into appearance', () => {
    const view = mount();

    act(() => pill(view, 'data-tab-close-position', 'left').props.onClick());

    expect(useStore.getState().appearance.tabCloseButtonPosition).toBe('left');
    expect(isSelected(view, 'data-tab-close-position', 'left')).toBe(true);
    expect(isSelected(view, 'data-tab-close-position', 'right')).toBe(false);

    act(() => view.unmount());
  });

  it('falls back to card and right for invalid or missing stored values', () => {
    const view = mount();

    act(() => {
      useStore.setState({
        appearance: {
          ...DEFAULT_APPEARANCE,
          tabAppearanceStyle: 'menu',
          tabCloseButtonPosition: 'top',
        } as unknown as AppearanceSettings,
      });
    });
    expect(isSelected(view, 'data-tab-appearance-style', 'card')).toBe(true);
    expect(isSelected(view, 'data-tab-close-position', 'right')).toBe(true);

    const legacy: Record<string, unknown> = { ...DEFAULT_APPEARANCE };
    delete legacy.tabAppearanceStyle;
    delete legacy.tabCloseButtonPosition;
    act(() => useStore.setState({ appearance: legacy as unknown as AppearanceSettings }));
    expect(isSelected(view, 'data-tab-appearance-style', 'card')).toBe(true);
    expect(isSelected(view, 'data-tab-close-position', 'right')).toBe(true);

    act(() => view.unmount());
  });

  it('routes tab appearance search entries to the tabs settings page', () => {
    expect(routePreferenceSearchEntry({
      group: 'preferences',
      item: 'theme-workspace',
      labelKey: 'app.theme.tab_appearance.style.pill',
    })).toMatchObject({ group: 'tabs-settings', item: 'tabs-settings' });
  });
});
