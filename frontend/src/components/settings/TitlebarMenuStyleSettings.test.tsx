import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import TitlebarMenuStyleSettings from './TitlebarMenuStyleSettings';

const setAppearance = vi.fn();
let currentStyle = 'classic';

vi.mock('../../store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({
    appearance: { titlebarMenuStyle: currentStyle },
    setAppearance,
  }),
}));

vi.mock('../../i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe('TitlebarMenuStyleSettings', () => {
  it('offers workspace tabs first, then the view menu', () => {
    currentStyle = 'classic';
    setAppearance.mockClear();
    const renderer = create(<TitlebarMenuStyleSettings />);
    const group = renderer.root.findByProps({ role: 'radiogroup' });
    const choices = group.findAllByProps({ role: 'radio' });

    expect(group.props['aria-label']).toBe('app.theme.appearance.titlebar_menu_style_title');
    expect(choices.map((choice) => choice.props['data-titlebar-style'])).toEqual(['classic', 'view-menu']);
    expect(choices[0].props['aria-checked']).toBe(true);
    expect(choices[0].props.className).toContain('is-active');
    expect(choices[1].props['aria-checked']).toBe(false);
  });

  it('writes the selected style through setAppearance', () => {
    currentStyle = 'classic';
    setAppearance.mockClear();
    const renderer = create(<TitlebarMenuStyleSettings />);

    renderer.root.findByProps({ 'data-titlebar-style': 'view-menu' }).props.onClick();

    expect(setAppearance).toHaveBeenCalledWith({ titlebarMenuStyle: 'view-menu' });
  });

  it('reflects the persisted style instead of a local default', () => {
    currentStyle = 'view-menu';
    setAppearance.mockClear();
    const renderer = create(<TitlebarMenuStyleSettings />);

    expect(renderer.root.findByProps({ 'data-titlebar-style': 'view-menu' }).props['aria-checked']).toBe(true);
    expect(renderer.root.findByProps({ 'data-titlebar-style': 'classic' }).props['aria-checked']).toBe(false);
  });

  it('shows a one-line description on each choice', () => {
    currentStyle = 'classic';
    const renderer = create(<TitlebarMenuStyleSettings />);
    const classic = renderer.root.findByProps({ 'data-titlebar-style': 'classic' });
    const text = classic.findAllByType('span')
      .flatMap((span) => span.children.filter((child): child is string => typeof child === 'string'));

    expect(text).toContain('app.theme.appearance.titlebar_menu_style.classic');
    expect(text).toContain('app.theme.appearance.titlebar_menu_style.classic_hint');
  });
});
