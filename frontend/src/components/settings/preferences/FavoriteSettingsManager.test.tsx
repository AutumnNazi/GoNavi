// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { Button, Checkbox, Input } from 'antd';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../store';
import { DEFAULT_APPEARANCE } from '../../../store/storeConstants';
import { t } from '../../../i18n';
import { FavoriteSettingsManager } from './FavoriteSettingsManager';
import { FAVORITE_SETTINGS_CATALOG } from './favoriteSettingsCatalog';

beforeEach(() => useStore.setState({ appearance: { ...DEFAULT_APPEARANCE, favoriteSettings: ['layout', 'scale'] } }));
describe('user-managed favorite settings', () => {
  it('reorders favorites and adds a searched setting without changing its underlying value', () => {
    let view!: ReturnType<typeof create>;
    act(() => { view = create(<FavoriteSettingsManager />); });
    const up = view.root.findAllByType('button').find(button => button.props['aria-label'] === t('settings.favorites.move_up', { name: t('app.theme.appearance.ui_scale_title') }))!;
    act(() => up.props.onClick());
    expect(useStore.getState().appearance.favoriteSettings).toEqual(['scale', 'layout']);
    act(() => view.root.findByType(Input).props.onChange({ target: { value: t('app.theme.font_family.mono_title') } }));
    expect(view.root.findAllByType(Checkbox)).toHaveLength(1);
    act(() => view.root.findByType(Checkbox).props.onChange());
    const target = FAVORITE_SETTINGS_CATALOG.find(item => item.labelKey === 'app.theme.font_family.mono_title')!;
    expect(useStore.getState().appearance.favoriteSettings).toEqual(['scale', 'layout', target.id]);
    expect(useStore.getState().appearance.customMonoFontFamily).toBe(DEFAULT_APPEARANCE.customMonoFontFamily);
    act(() => view.unmount());
  });
  it('permits removing all favorites', () => {
    useStore.setState({ appearance: { ...DEFAULT_APPEARANCE, favoriteSettings: ['layout'] } });
    let view!: ReturnType<typeof create>;
    act(() => { view = create(<FavoriteSettingsManager />); });
    const selected = view.root.findAllByType(Checkbox).find(checkbox => checkbox.props.checked)!;
    act(() => selected.props.onChange());
    expect(useStore.getState().appearance.favoriteSettings).toEqual([]);
    act(() => view.unmount());
  });
});
