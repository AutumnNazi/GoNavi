import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useDownloadedFontSelection } from './useDownloadedFontSelection';
import { fontInstalled } from './testFixtures';
import { loadDownloadedFont } from './faces';
vi.mock('./faces', () => ({ loadDownloadedFont: vi.fn() }));
const installed = fontInstalled();
const value = '"' + installed.family + '", monospace';

describe('downloaded selector activation gate', () => {
  it('does not commit a selector value until the downloaded face decodes', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(loadDownloadedFont).mockReturnValue(new Promise<void>((_, failure) => { reject = failure; }));
    const onSelect = vi.fn();
    let state!: ReturnType<typeof useDownloadedFontSelection>;
    const Probe = () => { state = useDownloadedFontSelection([installed], onSelect); return null; };
    let view!: ReturnType<typeof create>;
    act(() => { view = create(<Probe />); });
    let selecting!: Promise<void>;
    act(() => { selecting = state.selectFont('mono', value); });
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => { reject(new Error('invalid font')); await selecting; });
    expect(onSelect).not.toHaveBeenCalled();
    expect(state.error).toBeTruthy();
    act(() => view.unmount());
  });
  it('does not reapply a late downloaded selection after reset', async () => {
    let resolve!: () => void;
    vi.mocked(loadDownloadedFont).mockReturnValue(new Promise<void>(done => { resolve = done; }));
    const onSelect = vi.fn();
    let state!: ReturnType<typeof useDownloadedFontSelection>;
    const Probe = () => { state = useDownloadedFontSelection([installed], onSelect); return null; };
    let view!: ReturnType<typeof create>;
    act(() => { view = create(<Probe />); });
    let selecting!: Promise<void>;
    act(() => { selecting = state.selectFont('mono', value); });
    await act(async () => { await state.selectFont('mono', null); });
    await act(async () => { resolve(); await selecting; });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('mono', null);
    act(() => view.unmount());
  });
});
