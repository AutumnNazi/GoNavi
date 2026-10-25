import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketAccount } from './useMarketAccount';
vi.mock('../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('antd', () => {
  const element = (name: string) => ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('div', { ...props, 'data-component': name }, children);
  return { Input: element('input'), Button: element('button'), Typography: { Paragraph: element('paragraph') } };
});
import { MarketSourceSettings } from './MarketSourceSettings';
let renderer: ReturnType<typeof create> | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });
const account = (busy = false): MarketAccount => ({ settings: { baseUrl: 'https://plugin.gonavi.org', authenticated: false }, login: null, status: '', error: '', busy,
  revision: 0, start: vi.fn(), cancel: vi.fn(), configure: vi.fn(), logout: vi.fn(), refresh: vi.fn() });
const input = () => renderer!.root.findByProps({ 'data-component': 'input' });
async function mount(value: MarketAccount, allowed = true) {
  await act(async () => { renderer = create(<MarketSourceSettings account={value} allowed={allowed} />); });
}
async function submit() { await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); }); }
describe('secondary source settings', () => {
  it('saves a trimmed source and retains explicit marketplace disabling', async () => {
    const value = account(); await mount(value);
    await act(async () => { input().props.onChange({ target: { value: ' https://private.example ' } }); });
    await submit(); expect(value.configure).toHaveBeenLastCalledWith('https://private.example');
    await act(async () => { input().props.onChange({ target: { value: '' } }); });
    await submit(); expect(value.configure).toHaveBeenLastCalledWith('');
  });
  it.each(['javascript:alert(1)', 'https://user:secret@example.test'])('does not submit an unsafe source: %s', async (source) => {
    const value = account(); await mount(value);
    await act(async () => { input().props.onChange({ target: { value: source } }); });
    await submit(); expect(value.configure).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ 'data-component': 'button' }).props.disabled).toBe(true);
  });
  it.each(['readonly', 'busy'])('keeps %s settings non-mutating', async (mode) => {
    const value = account(mode === 'busy'); await mount(value, mode !== 'readonly');
    expect(input().props.disabled).toBe(true); await submit(); expect(value.configure).not.toHaveBeenCalled();
  });
});
