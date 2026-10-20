// @vitest-environment jsdom
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FontFamilySelect } from './FontFamilySelect';
import { buildFontFamilyOptions, DEFAULT_MONO_FONT_FAMILY, DEFAULT_UI_FONT_FAMILY } from '../../utils/fontFamilies';

const t = (key: string) => key;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const selectedText = () => container.querySelector('.ant-select-selection-item')?.textContent;
const renderPicker = (props: Partial<React.ComponentProps<typeof FontFamilySelect>> = {}) => {
  act(() => root.render(<FontFamilySelect kind="mono" value={null} options={buildFontFamilyOptions('linux', 'mono', [])}
    loading={false} onChange={() => {}} t={t} {...props} />));
};

describe('FontFamilySelect with real Ant Design controls', () => {
  it.each(['ui', 'mono'] as const)('shows a friendly %s default rather than a CSS placeholder', kind => {
    renderPicker({ kind, options: [], loading: true });
    expect(selectedText()).toBe(t(kind === 'ui' ? 'app.theme.font_family.default_ui_option' : 'app.theme.font_family.default_mono_option'));
    const preview = container.querySelector<HTMLElement>('.gonavi-font-preview-sample');
    expect(preview?.style.fontFamily).toBe(kind === 'ui' ? DEFAULT_UI_FONT_FAMILY : DEFAULT_MONO_FONT_FAMILY);
    expect(container.querySelector('button')?.disabled).toBe(true);
  });

  it('keeps an unmatched legacy value readable through loading, success and failure', () => {
    const value = '"JetBrainsMono Nerd Font Mono", Menlo, monospace';
    const onChange = vi.fn();
    renderPicker({ value, options: [], loading: true, onChange });
    expect(selectedText()).toBe('JetBrainsMono Nerd Font Mono');
    renderPicker({ value, options: buildFontFamilyOptions('linux', 'mono', ['JetBrainsMono Nerd Font Mono']), onChange });
    expect(selectedText()).toBe('JetBrainsMono Nerd Font Mono');
    renderPicker({ value, options: [], onChange });
    expect(selectedText()).toBe('JetBrainsMono Nerd Font Mono');
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('details code')?.textContent).toBe(value);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('updates an exact option label when installed fonts finish loading', () => {
    const options = buildFontFamilyOptions('linux', 'mono', ['JetBrainsMono']);
    const value = options.find(option => option.keywords?.includes('installed'))!.value;
    renderPicker({ value, options: [], loading: true });
    expect(selectedText()).toBe('JetBrainsMono');
    renderPicker({ value, options });
    expect(selectedText()).toBe(options.find(option => option.value === value)?.label);
  });

  it('restores defaults with both the reset button and clear control', () => {
    const onChange = vi.fn();
    renderPicker({ value: '"Legacy", monospace', onChange });
    act(() => container.querySelector('button')!.click());
    expect(onChange).toHaveBeenLastCalledWith(null);
    act(() => container.querySelector('.ant-select-clear')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('keeps dropdown rows compact and reserves samples for the selected-font preview', () => {
    renderPicker();
    act(() => container.querySelector('.ant-select-selector')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    const dropdown = document.querySelector('.ant-select-dropdown')!;
    expect(dropdown.textContent).not.toContain('app.theme.font_family.preview_mono');
    expect(dropdown.querySelector('.gonavi-font-option-source')?.textContent).not.toBe('app.theme.font_family.default_mono_option');
    expect(container.querySelector('.gonavi-font-preview-sample')?.textContent).toContain('app.theme.font_family.specimen.sql');
  });

  it('searches installed fonts and saves the full stack, not the display label', () => {
    const options = buildFontFamilyOptions('linux', 'mono', ['Victor', 'Zed Mono']);
    const onChange = vi.fn();
    renderPicker({ options, onChange });
    act(() => container.querySelector('.ant-select-selector')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => {
      const input = container.querySelector('input')!;
      input.value = 'Victor';
      Simulate.change(input);
    });
    const option = document.querySelector<HTMLElement>('.ant-select-item-option');
    expect(option?.textContent).toContain('Victor');
    expect(option?.textContent).toContain('app.theme.font_family.source_installed');
    expect(option?.textContent).not.toContain('ui-monospace');
    act(() => option!.click());
    expect(onChange).toHaveBeenLastCalledWith(options.find(entry => entry.label === 'Victor')!.value);
    expect(container.querySelector('input')?.getAttribute('aria-describedby')).toBe(container.querySelector('.gonavi-settings-inline-meta')?.id);
  });
});
