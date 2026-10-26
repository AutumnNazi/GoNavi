import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';

import type { AIProviderConfig } from '../../../types';
import {
  buildProviderGroups,
  isGlmHighspeedModel,
  pickModelForProvider,
  type ComposerProviderGroup,
} from './composerMenuModel';
import { useComposerMenuPlacement } from './useComposerMenuPlacement';
import {
  coerceThinkingIntensityForControl,
  resolveProviderThinkingIntensityControl,
} from '../../../utils/aiThinkingIntensity';
import type { CLIModelCatalog } from '../../../utils/aiProviderManagement';
import type { ThoughtLevel } from './ComposerThoughtSlider';

interface CLIThinkingCapability {
  supportsEffort?: boolean;
  effortValues?: string[];
  defaultEffort?: string;
}

export interface ComposerMenuStateInput {
  activeProvider: AIProviderConfig;
  providers?: AIProviderConfig[];
  providerModels?: Record<string, string[]>;
  dynamicModels: string[];
  thinkingIntensity?: string;
  cliCapability?: CLIThinkingCapability;
  cliCatalog?: CLIModelCatalog;
  onModelChange: (value: string) => void | Promise<void>;
  onProviderModelChange?: (providerId: string, model: string) => void | Promise<void>;
  onManageProvider?: (providerId: string) => void;
  onFetchModels: () => void;
  onFetchProviderModels?: (providerId: string) => void;
  onThinkingIntensityChange?: (value: string) => void;
  labelForLevel: (labelKey: string) => string;
}

export interface ComposerMenuState {
  open: boolean;
  providerOpen: boolean;
  narrow: boolean;
  loadingModels: boolean;
  groups: ComposerProviderGroup[];
  shownId: string;
  currentModel: string;
  levels: ThoughtLevel[];
  effortValue: string;
  highspeed: boolean;
  menuStyle: CSSProperties;
  submenuStyle: CSSProperties;
  triggerRef: RefObject<HTMLButtonElement>;
  menuRef: RefObject<HTMLDivElement>;
  submenuRef: RefObject<HTMLDivElement>;
  toggle: () => void;
  selectProvider: (providerId: string) => void;
  selectModel: (providerId: string, model: string) => void;
  changeEffort: (value: string) => void;
  manage: () => void;
  setProviderOpen: (open: boolean) => void;
  hoverProviderStart: () => void;
  hoverProviderEnd: () => void;
  fetchProvider: (providerId: string) => void;
  closeProviders: () => void;
  closeMenu: () => void;
}

export const useComposerModelMenuState = (
  input: ComposerMenuStateInput,
  loadingModels: boolean,
): ComposerMenuState => {
  const [open, setOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [browseId, setBrowseId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const groups = useMemo(() => buildProviderGroups(
    input.providers, input.activeProvider, input.dynamicModels, input.providerModels,
  ), [input.providers, input.activeProvider, input.dynamicModels, input.providerModels]);
  const shownId = browseId && groups.some((group) => group.provider.id === browseId)
    ? browseId
    : input.activeProvider.id;
  const currentModel = String(input.activeProvider.model || '').trim();
  const control = resolveProviderThinkingIntensityControl(input.activeProvider, input.cliCapability, input.cliCatalog);
  const effortValue = coerceThinkingIntensityForControl(input.thinkingIntensity, control);
  const levels = control.options.map((option) => ({ value: option.value, label: input.labelForLevel(option.labelKey) }));
  const placement = useComposerMenuPlacement(open, providerOpen, `${shownId}:${levels.length}`, triggerRef, menuRef, submenuRef);

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
  }, []);

  useEffect(() => {
    if (open) return undefined;
    setProviderOpen(false);
    setBrowseId(null);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const clearHover = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
  };

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (!next) return next;
      const active = groups.find((group) => group.provider.id === input.activeProvider.id);
      if (active && active.models.length === 0 && !active.usesLocalCLI) input.onFetchModels();
      return next;
    });
  };

  const selectProvider = (providerId: string) => {
    const group = groups.find((item) => item.provider.id === providerId);
    if (!group) return;
    setBrowseId(providerId);
    setProviderOpen(false);
    const nextModel = pickModelForProvider(group, currentModel);
    if (nextModel == null) return;
    if (providerId === input.activeProvider.id && nextModel === currentModel) return;
    if (input.onProviderModelChange) void input.onProviderModelChange(providerId, nextModel);
    else if (providerId === input.activeProvider.id) void input.onModelChange(nextModel);
  };

  const selectModel = (providerId: string, model: string) => {
    if (input.onProviderModelChange) void input.onProviderModelChange(providerId, model);
    else if (providerId === input.activeProvider.id) void input.onModelChange(model);
    setOpen(false);
  };

  return {
    open, providerOpen, narrow: placement.narrow, loadingModels, groups, shownId, currentModel, levels, effortValue,
    highspeed: isGlmHighspeedModel(currentModel),
    menuStyle: placement.menuStyle, submenuStyle: placement.submenuStyle,
    triggerRef, menuRef, submenuRef, toggle, selectProvider, selectModel,
    changeEffort: (value) => input.onThinkingIntensityChange?.(value),
    manage: () => { input.onManageProvider?.(input.activeProvider.id); setOpen(false); },
    setProviderOpen: (next) => { clearHover(); setProviderOpen(next); if (next) input.onFetchProviderModels?.(shownId); },
    hoverProviderStart: () => {
      clearHover();
      if (placement.narrow) return;
      setProviderOpen(true);
      input.onFetchProviderModels?.(shownId);
    },
    hoverProviderEnd: () => {
      if (placement.narrow) return;
      clearHover();
      hoverTimer.current = window.setTimeout(() => setProviderOpen(false), 140);
    },
    fetchProvider: (providerId) => input.onFetchProviderModels?.(providerId),
    closeProviders: () => {
      setProviderOpen(false);
      menuRef.current?.querySelector<HTMLElement>('[data-testid="composer-provider-trigger"]')?.focus();
    },
    closeMenu: () => {
      setOpen(false);
      triggerRef.current?.focus();
    },
  };
};
