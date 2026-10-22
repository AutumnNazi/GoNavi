// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AIProviderConfig } from '../../types';
import AIChatProviderModelSelect from './AIChatProviderModelSelect';
import { hoveredThoughtLevel, thoughtSliderProgress } from './composerMenu/composerThoughtMotion';
import { placeComposerMenu, placeProviderSubmenu } from './composerMenu/composerMenuPlacement';
import { isNoThoughtLevel, pickModelForProvider, thoughtMeterProgress } from './composerMenu/composerMenuModel';

const provider = (patch: Partial<AIProviderConfig>): AIProviderConfig => ({
  id: 'provider-openai',
  name: 'OpenAI Main',
  type: 'openai',
  apiKey: '',
  hasSecret: true,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5',
  models: ['gpt-5', 'gpt-5-mini'],
  maxTokens: 0,
  temperature: 0.7,
  ...patch,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  }));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const renderPicker = (props: Partial<React.ComponentProps<typeof AIChatProviderModelSelect>> = {}) => {
  const providers = props.providers || [
    provider({ customModels: ['gpt-custom'], disabledModels: ['gpt-5-mini'] }),
    provider({ id: 'provider-grok', name: 'Grok', model: 'grok-4', models: ['grok-4', 'grok-3'] }),
  ];
  act(() => {
    root.render(
      <AIChatProviderModelSelect
        activeProvider={providers[0]}
        providers={providers}
        providerModels={{ 'provider-grok': ['grok-4', 'grok-3', 'grok-2'] }}
        dynamicModels={['gpt-5', 'gpt-5-mini', 'gpt-live']}
        loadingModels={false}
        onModelChange={vi.fn()}
        onProviderModelChange={vi.fn()}
        onManageProvider={vi.fn()}
        onFetchModels={vi.fn()}
        onFetchProviderModels={vi.fn()}
        thinkingIntensity="medium"
        onThinkingIntensityChange={vi.fn()}
        {...props}
      />,
    );
  });
};

const click = (selector: string) => {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  act(() => node.click());
  return node;
};

describe('ZCode composer model menu', () => {
  it('lists the active provider models and switches provider from the side menu', () => {
    const onProviderModelChange = vi.fn();
    const onFetchProviderModels = vi.fn();
    const onManageProvider = vi.fn();
    renderPicker({ onProviderModelChange, onFetchProviderModels, onManageProvider });
    click('.gn-v2-ai-provider-model-trigger');
    expect(Array.from(document.querySelectorAll('[data-model-id]')).map((node) => node.getAttribute('data-model-id')))
      .toEqual(['gpt-5', 'gpt-live', 'gpt-custom']);
    click('[data-testid="composer-provider-trigger"]');
    const grok = document.querySelector<HTMLElement>('[data-provider-id="provider-grok"]');
    act(() => grok?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
    expect(onFetchProviderModels).toHaveBeenCalledWith('provider-grok');
    act(() => grok?.click());
    expect(onProviderModelChange).toHaveBeenCalledWith('provider-grok', 'grok-4');
    click('[data-model-id="grok-3"]');
    expect(onProviderModelChange).toHaveBeenCalledWith('provider-grok', 'grok-3');
    click('.gn-v2-ai-provider-model-trigger');
    click('[data-testid="composer-manage-models"]');
    expect(onManageProvider).toHaveBeenCalledWith('provider-openai');
  });

  it('does not fetch models when a CLI subscription opens with automatic selection', () => {
    const onFetchModels = vi.fn();
    const cli = provider({
      id: 'provider-codex', name: 'Codex Subscription', type: 'custom', apiFormat: 'codex-cli', authMode: 'local-cli', model: '', models: [],
    });
    renderPicker({ activeProvider: cli, providers: [cli], dynamicModels: [], onFetchModels });
    expect(document.querySelector('.gn-v2-ai-provider-model-trigger')?.textContent).toContain('Auto-selected');
    click('.gn-v2-ai-provider-model-trigger');
    expect(onFetchModels).not.toHaveBeenCalled();
    expect(document.querySelector('[data-model-id]')?.getAttribute('data-model-id')).toBe('');
  });

  it('moves the reasoning slider with the ZCode fill, max bubbles, and hover scale', () => {
    const onThinkingIntensityChange = vi.fn();
    renderPicker({ thinkingIntensity: 'xhigh', onThinkingIntensityChange });
    click('.gn-v2-ai-provider-model-trigger');
    const slider = document.querySelector<HTMLInputElement>('[data-testid="composer-thought-slider"]');
    expect(slider).toBeTruthy();
    expect(document.querySelector('[data-testid="composer-thought-bubbles"]')).toBeTruthy();
    expect(document.querySelector('.gn-zcode-thought-fill')?.getAttribute('data-max')).toBe('true');
    const fill = document.querySelector<HTMLElement>('.gn-zcode-thought-fill');
    expect(fill?.style.width).toContain('100% - 28px');
    slider!.getBoundingClientRect = () => ({ left: 0, width: 228, top: 0, height: 32, right: 228, bottom: 32, x: 0, y: 0, toJSON() { return {}; } });
    act(() => {
      slider!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 14 }));
    });
    expect(document.querySelector('.gn-zcode-thought-stop[data-hovered="true"]')).toBeTruthy();
    const prototype = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    act(() => {
      prototype?.set?.call(slider, '2');
      slider!.dispatchEvent(new Event('input', { bubbles: true }));
      slider!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onThinkingIntensityChange).toHaveBeenCalledWith('low');
  });

  it('keeps the fill empty on a no-thought level and disables the slider while browsing another provider', () => {
    const onThinkingIntensityChange = vi.fn();
    renderPicker({ thinkingIntensity: 'none', onThinkingIntensityChange });
    click('.gn-v2-ai-provider-model-trigger');
    const fill = document.querySelector<HTMLElement>('.gn-zcode-thought-fill');
    expect(fill?.style.width === '0' || fill?.style.width === '0px').toBe(true);
    expect(document.querySelector('[data-testid="composer-thought-track"]')?.getAttribute('data-progress')).toBe('0');
    expect(document.querySelector('[data-testid="composer-thought-bubbles"]')).toBeNull();
    click('[data-testid="composer-provider-trigger"]');
    click('[data-provider-id="provider-grok"]');
    expect(document.querySelector('[data-testid="composer-thought-slider"]')?.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('ZCode composer geometry', () => {
  it('opens the menu above the trigger and flips the provider submenu to the left', () => {
    expect(placeComposerMenu(
      { top: 500, left: 400, right: 640, bottom: 532, width: 240, height: 32 },
      { top: 0, left: 0, right: 280, bottom: 360, width: 280, height: 360 },
      1000, 800,
    )).toEqual({ top: 136, left: 360 });
    expect(placeProviderSubmenu(
      { top: 100, left: 700, right: 980, bottom: 400, width: 280, height: 300 },
      { top: 0, left: 0, right: 200, bottom: 220, width: 200, height: 220 },
      1000, 800,
    ).left).toBe(496);
    expect(isNoThoughtLevel('none')).toBe(true);
    expect(thoughtMeterProgress([{ value: 'off' }, { value: 'low' }, { value: 'high' }], 'off')).toBe(0);
    expect(thoughtMeterProgress([{ value: 'off' }, { value: 'low' }, { value: 'high' }], 'high')).toBe(100);
    expect(thoughtSliderProgress(3, 0, true)).toBe(0);
    expect(hoveredThoughtLevel(14, { left: 0, width: 228 }, [{ value: 'none' }, { value: 'low' }], false, 'mouse')).toBe('none');
    expect(pickModelForProvider({ provider: provider({}), models: ['a', 'b'], usesLocalCLI: false }, 'missing')).toBe('a');
  });
});
