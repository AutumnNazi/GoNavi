// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from 'antd';
import { t } from '../../../i18n';
import { useStore } from '../../../store';
import { DEFAULT_APPEARANCE } from '../../../store/storeConstants';
import { ActionPlacementPreferencePreview } from './ActionPlacementPreferencePreview';
import { LivePreviewWorkbench } from './livePreview/LivePreviewWorkbench';
import TitlebarActionsPlacementSettings from '../TitlebarActionsPlacementSettings';

vi.mock('../../../i18n/provider', () => ({ useI18n: () => ({ t }), useOptionalI18n: () => ({ t }) }));
vi.mock('./livePreview/PreviewSurface', () => ({ PreviewSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('./livePreview/LivePreviewWorkbench', () => ({ LivePreviewWorkbench: () => <div /> }));
beforeEach(() => useStore.setState({ appearance: { ...DEFAULT_APPEARANCE, titlebarActionsPlacement: 'toolbar', titlebarActionsDisplay: 'text', sidebarActionsPlacement: 'rail' } }));
function choose(view: ReactTestRenderer, attribute: string, value: string) {
  act(() => view.root.findAllByType('button').find(button => button.props[attribute] === value)!.props.onClick());
}

describe('action placement previews', () => {
  it('previews placement on its own and applies only the location preference', () => {
    let view!: ReactTestRenderer;
    act(() => { view = create(<ActionPlacementPreferencePreview area="titlebar" />); });
    choose(view, 'data-titlebar-actions-placement', 'titlebar');
    expect(view.root.findAllByType('button').some(button => button.props['data-titlebar-actions-display'])).toBe(false);
    expect(view.root.findByType(LivePreviewWorkbench).props.actions).toEqual({ titlebarActionsPlacement: 'titlebar' });
    expect(useStore.getState().appearance).toMatchObject({ titlebarActionsPlacement: 'toolbar', titlebarActionsDisplay: 'text' });
    act(() => useStore.getState().setAppearance({ sidebarActionsPlacement: 'toolbar', titlebarActionsDisplay: 'icon' }));
    expect(view.root.findByType(LivePreviewWorkbench).props.actions.titlebarActionsPlacement).toBe('titlebar');
    act(() => view.root.findByType(Button).props.onClick());
    expect(useStore.getState().appearance).toMatchObject({ titlebarActionsPlacement: 'titlebar', titlebarActionsDisplay: 'icon', sidebarActionsPlacement: 'toolbar', uiLayoutMode: 'classic' });
    expect(view.root.findByType(Button).props.disabled).toBe(true);
    act(() => view.unmount());
  });

  it('previews display using inline actions without applying a placement change', () => {
    let view!: ReactTestRenderer;
    act(() => { view = create(<ActionPlacementPreferencePreview area="titlebar-display" />); });
    choose(view, 'data-titlebar-actions-display', 'icon');
    expect(view.root.findByType(LivePreviewWorkbench).props.actions).toEqual({ titlebarActionsPlacement: 'titlebar', titlebarActionsDisplay: 'icon' });
    expect(useStore.getState().appearance).toMatchObject({ titlebarActionsPlacement: 'toolbar', titlebarActionsDisplay: 'text' });
    act(() => useStore.getState().setAppearance({ sidebarActionsPlacement: 'toolbar' }));
    expect(view.root.findByType(LivePreviewWorkbench).props.actions.titlebarActionsDisplay).toBe('icon');
    act(() => view.root.findByType(Button).props.onClick());
    expect(useStore.getState().appearance).toMatchObject({ titlebarActionsPlacement: 'toolbar', titlebarActionsDisplay: 'icon', sidebarActionsPlacement: 'toolbar' });
    expect(view.root.findByType(Button).props.disabled).toBe(true);
    act(() => view.unmount());
  });

  it('previews sidebar placement locally and keeps the current titlebar configuration', () => {
    let view!: ReactTestRenderer;
    act(() => { view = create(<ActionPlacementPreferencePreview area="sidebar" />); });
    choose(view, 'data-sidebar-actions-placement', 'toolbar');
    expect(view.root.findByType(LivePreviewWorkbench).props.actions).toEqual({ sidebarActionsPlacement: 'toolbar' });
    expect(useStore.getState().appearance.sidebarActionsPlacement).toBe('rail');
    act(() => useStore.getState().setAppearance({ titlebarActionsDisplay: 'icon-text' }));
    expect(view.root.findByType(LivePreviewWorkbench).props.actions.sidebarActionsPlacement).toBe('toolbar');
    act(() => view.root.findByType(Button).props.onClick());
    expect(useStore.getState().appearance).toMatchObject({ sidebarActionsPlacement: 'toolbar', titlebarActionsDisplay: 'icon-text' });
    act(() => view.unmount());
  });

  it('discards unapplied changes when leaving and follows applied settings on return', () => {
    let view!: ReactTestRenderer;
    act(() => { view = create(<ActionPlacementPreferencePreview area="sidebar" />); });
    choose(view, 'data-sidebar-actions-placement', 'toolbar');
    act(() => view.unmount());
    act(() => { view = create(<ActionPlacementPreferencePreview area="sidebar" />); });
    expect(view.root.findByType(LivePreviewWorkbench).props.actions.sidebarActionsPlacement).toBe('rail');
    act(() => useStore.getState().setAppearance({ sidebarActionsPlacement: 'toolbar' }));
    expect(view.root.findByType(LivePreviewWorkbench).props.actions.sidebarActionsPlacement).toBe('toolbar');
    expect(view.root.findByType(Button).props.disabled).toBe(true);
    act(() => view.unmount());
  });

  it('keeps quick settings immediately editable when no preview controller is supplied', () => {
    let view!: ReactTestRenderer;
    act(() => { view = create(<TitlebarActionsPlacementSettings />); });
    choose(view, 'data-titlebar-actions-placement', 'titlebar');
    choose(view, 'data-titlebar-actions-display', 'icon-text');
    expect(useStore.getState().appearance).toMatchObject({ titlebarActionsPlacement: 'titlebar', titlebarActionsDisplay: 'icon-text' });
    act(() => view.unmount());
  });
});
