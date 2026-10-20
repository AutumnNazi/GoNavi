// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConnectionModal from './ConnectionModal';
import { useStore } from '../store';
import { setCurrentLanguage } from '../i18n';

vi.mock('../../wailsjs/go/app/App', async importOriginal => ({
  ...await importOriginal<typeof import('../../wailsjs/go/app/App')>(),
  GetDriverStatusList: vi.fn(async () => ({ success: true, data: { drivers: [{ type: 'mysql', connectable: true }] } })),
}));
let container: HTMLDivElement;
let root: Root;
const original = useStore.getState();
const theme = { token: { motion: false } };
const close = vi.fn();
async function render(open: boolean) {
  await act(async () => root.render(<ConfigProvider theme={theme}><ConnectionModal open={open} onClose={close} /></ConfigProvider>));
}
function button(selector: string) { return document.querySelector<HTMLButtonElement>(selector)!; }
async function selectMySQL() { await act(async () => button('[data-connection-type-key="mysql"]').click()); }
async function section(index: number) {
  const target = document.querySelectorAll<HTMLButtonElement>('.gn-conn-form-nav-item')[index];
  await act(async () => target.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element));
  setCurrentLanguage('en-US');
  useStore.setState({ connections: [], recentConnectionTargets: [], pinnedConnectionTypes: [] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  useStore.setState(original, true); setCurrentLanguage('zh-CN');
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('retains the credential-free picker across close and reopen', async () => {
  await render(true);
  const card = button('[data-connection-type-key="mysql"]');
  expect(card).toBeTruthy();
  await render(false);
  await render(true);
  expect(button('[data-connection-type-key="mysql"]')).toBe(card);
});

it('reuses visited form fields across sections, but destroys all form content on close', async () => {
  await render(true); await selectMySQL();
  const input = document.querySelector<HTMLInputElement>('.gn-conn-studio-form input[id="name"]')!;
  expect(input).toBeTruthy();
  await section(1);
  expect(input.isConnected).toBe(true);
  expect(input.closest('[hidden]')).not.toBeNull();
  await section(0);
  expect(document.querySelector('.gn-conn-studio-form input[id="name"]')).toBe(input);
  await render(false);
  expect(document.querySelector('.gn-conn-studio-form')).toBeNull();
  expect(input.isConnected).toBe(false);
  await render(true); await selectMySQL();
  expect(document.querySelector('.gn-conn-studio-form input[id="name"]')).not.toBe(input);
});
