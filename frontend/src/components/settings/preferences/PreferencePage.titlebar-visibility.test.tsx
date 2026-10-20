// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '../../../i18n';
import { useStore } from '../../../store';
import { DEFAULT_APPEARANCE } from '../../../store/storeConstants';
import { PreferencePage } from './PreferencePage';
import { LivePreviewWorkbench } from './livePreview/LivePreviewWorkbench';

vi.mock('../../../i18n/provider', () => ({ useI18n: () => ({ t }), useOptionalI18n: () => ({ t }) }));
vi.mock('./PreferenceControls', () => ({ PreferenceControls: () => <div /> }));
vi.mock('./livePreview/PreviewSurface', () => ({ PreviewSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('./livePreview/LivePreviewWorkbench', () => ({ LivePreviewWorkbench: () => <div /> }));
beforeEach(() => useStore.setState({ appearance: { ...DEFAULT_APPEARANCE, titlebarActionsPlacement: 'toolbar', titlebarActionsDisplay: 'text' } }));

function render() {
  let view!: ReactTestRenderer;
  act(() => { view = create(<PreferencePage page="layout-settings" renderTheme={() => null} metadata={() => null} objects={() => null} />); });
  return view;
}
function select(view: ReactTestRenderer, attribute: string, value: string) {
  act(() => view.root.findAllByType('button').find(button => button.props[attribute] === value)!.props.onClick());
}
function displaySections(view: ReactTestRenderer) {
  return view.root.findAllByType('section').filter(section => section.props['aria-label'] === t('app.theme.titlebar_actions_placement.display_title'));
}

it('shows display choices only for the currently previewed inline placement, preserving the hidden draft', () => {
  const view = render();
  try {
    expect(displaySections(view)).toHaveLength(0);
    expect(view.root.findAllByType(LivePreviewWorkbench)).toHaveLength(2);
    select(view, 'data-titlebar-actions-placement', 'titlebar');
    expect(displaySections(view)).toHaveLength(1);
    expect(view.root.findAllByType(LivePreviewWorkbench)).toHaveLength(3);
    expect(useStore.getState().appearance.titlebarActionsPlacement).toBe('toolbar');
    select(view, 'data-titlebar-actions-display', 'icon');
    select(view, 'data-titlebar-actions-placement', 'toolbar');
    expect(displaySections(view)).toHaveLength(0);
    expect(view.root.findAllByType('button').filter(button => button.props['data-titlebar-actions-display'])).toHaveLength(0);
    select(view, 'data-titlebar-actions-placement', 'titlebar');
    expect(view.root.findAllByType('button').find(button => button.props['data-titlebar-actions-display'] === 'icon')!.props['aria-pressed']).toBe(true);
    expect(useStore.getState().appearance.titlebarActionsDisplay).toBe('text');
  } finally { act(() => view.unmount()); }
});

it('hides choices immediately when previewing toolbar from a saved inline layout and follows external updates', () => {
  useStore.setState({ appearance: { ...useStore.getState().appearance, titlebarActionsPlacement: 'titlebar', titlebarActionsDisplay: 'icon-text' } });
  const view = render();
  try {
    expect(displaySections(view)).toHaveLength(1);
    select(view, 'data-titlebar-actions-placement', 'toolbar');
    expect(displaySections(view)).toHaveLength(0);
    expect(useStore.getState().appearance.titlebarActionsPlacement).toBe('titlebar');
    select(view, 'data-titlebar-actions-placement', 'titlebar');
    act(() => useStore.getState().setAppearance({ titlebarActionsPlacement: 'toolbar' }));
    expect(displaySections(view)).toHaveLength(0);
    expect(useStore.getState().appearance.titlebarActionsDisplay).toBe('icon-text');
  } finally { act(() => view.unmount()); }
});
