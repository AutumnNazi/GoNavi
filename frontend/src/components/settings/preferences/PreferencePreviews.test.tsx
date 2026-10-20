// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, Checkbox } from 'antd';
import { useStore } from '../../../store';
import { DEFAULT_APPEARANCE } from '../../../store/storeConstants';
import { t } from '../../../i18n';
import { LayoutPreferencePreview } from './LayoutPreferencePreview';
import { TablePreferencePreview } from './TablePreferencePreview';
import { LivePreviewGrid } from './livePreview/LivePreviewGrid';
vi.mock('./livePreview/PreviewSurface', () => ({ PreviewSurface: ({ children, mode }: { children: React.ReactNode; mode: string }) => <div data-layout-preview={mode}>{children}</div> }));
vi.mock('./livePreview/LivePreviewWorkbench', () => ({ LivePreviewWorkbench: () => <div /> }));
vi.mock('./livePreview/LivePreviewGrid', () => ({ LivePreviewGrid: () => <div /> }));

beforeEach(() => useStore.setState({ appearance: { ...DEFAULT_APPEARANCE } }));
describe('non-mutating settings previews', () => {
  it('previews Navicat without changing the active layout and applies only on request', () => {
    let view!: ReturnType<typeof create>;
    act(() => { view = create(<LayoutPreferencePreview />); });
    const choice = view.root.findAllByType('button').find(button => button.props.children === t('settings.preview.navicat'))!;
    act(() => choice.props.onClick());
    expect(view.root.findByProps({ 'data-layout-preview': 'navicat' })).toBeTruthy();
    expect(useStore.getState().appearance.uiLayoutMode).toBe('classic');
    const apply = view.root.findByType(Button);
    expect(apply.props.disabled).toBe(false);
    act(() => apply.props.onClick());
    expect(useStore.getState().appearance.uiLayoutMode).toBe('navicat');
    expect(view.root.findByType(Button).props.disabled).toBe(true);
    act(() => view.unmount());
  });
  it('previews density and row numbers using actual grid spacing without modifying either preference', () => {
    useStore.setState({ appearance: { ...DEFAULT_APPEARANCE, dataTableDensity: 'comfortable', showDataTableRowNumber: true } });
    let view!: ReturnType<typeof create>;
    act(() => { view = create(<TablePreferencePreview />); });
    const compact = view.root.findAllByType('button').find(button => button.props.children === t('app.theme.data_table.density.compact'))!;
    act(() => compact.props.onClick());
    act(() => view.root.findByType(Checkbox).props.onChange({ target: { checked: false } }));
    const grid = view.root.findByType(LivePreviewGrid);
    expect(grid.props.density).toBe('compact');
    expect(grid.props.rowNumbers).toBe(false);
    expect(useStore.getState().appearance.dataTableDensity).toBe('comfortable');
    expect(useStore.getState().appearance.showDataTableRowNumber).toBe(true);
    act(() => view.root.findByType(Button).props.onClick());
    expect(useStore.getState().appearance).toMatchObject({ dataTableDensity: 'compact', showDataTableRowNumber: false });
    act(() => useStore.getState().setAppearance({ showDataTableRowNumber: true }));
    expect(view.root.findByType(LivePreviewGrid).props.rowNumbers).toBe(true);
    act(() => view.unmount());
  });
  it('matches the real Navicat row-number rule without discarding the Classic preference', () => {
    useStore.getState().setAppearance({ uiLayoutMode: 'navicat', showDataTableRowNumber: true });
    let view!: ReturnType<typeof create>;
    act(() => { view = create(<TablePreferencePreview />); });
    expect(view.root.findByType(Checkbox).props.disabled).toBe(true);
    expect(view.root.findByType(LivePreviewGrid).props.rowNumbers).toBe(false);
    expect(useStore.getState().appearance.showDataTableRowNumber).toBe(true);
    act(() => useStore.getState().setAppearance({ uiLayoutMode: 'classic' }));
    expect(view.root.findByType(Checkbox).props.disabled).toBe(false);
    expect(view.root.findByType(LivePreviewGrid).props.rowNumbers).toBe(true);
    act(() => view.unmount());
  });

});
