import {
  SHORTCUT_ACTION_ORDER,
  isShortcutPhysicalMatch,
  resolveShortcutBinding,
  type ShortcutAction,
  type ShortcutOptions,
  type ShortcutPlatform,
} from './shortcuts';

export const CLOSE_ACTIVE_WORKSPACE_TAB_EVENT = 'gonavi:close-active-workspace-tab';
export const CLOSE_ACTIVE_RESULT_TAB_EVENT = 'gonavi:close-active-result-tab';

export type CloseShortcutScope = 'workspace' | 'result' | 'blocked';
export type CloseActiveResultShortcutOutcome = 'closed' | 'hidden' | 'ignored';

export interface CloseActiveResultShortcutRequest {
  targetTabId: string | null;
  handled: boolean;
  outcome: CloseActiveResultShortcutOutcome;
}

export const resolveDockedActiveTabId = (
  tabs: Array<{ id: string }>,
  activeTabId: string | null | undefined,
  detachedWindows: Array<{ tabId: string }>,
): string | null => {
  const detachedTabIds = new Set(detachedWindows.map((windowState) => windowState.tabId));
  const dockedTabs = tabs.filter((tab) => !detachedTabIds.has(tab.id));
  if (activeTabId && dockedTabs.some((tab) => tab.id === activeTabId)) {
    return activeTabId;
  }
  return dockedTabs[0]?.id ?? null;
};

export interface CloseShortcutKeyEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
}

export type CloseShortcutKeydownDecision =
  | { kind: 'ignore' | 'recording'; preventDefault: false; stopImmediatePropagation: false }
  | { kind: 'consume'; preventDefault: true; stopImmediatePropagation: true; ownerAction: ShortcutAction | null }
  | { kind: 'close'; preventDefault: true; stopImmediatePropagation: true; ownerAction: 'closeActiveTab' }
  | { kind: 'delegate'; preventDefault: true; stopImmediatePropagation: false; ownerAction: ShortcutAction };

export const getPlatformNativeCloseCombo = (platform: ShortcutPlatform): string => (
  platform === 'mac' ? 'Meta+W' : 'Ctrl+W'
);

const resolvePhysicalShortcutOwner = (
  event: CloseShortcutKeyEvent,
  shortcutOptions: Partial<ShortcutOptions> | null | undefined,
  platform: ShortcutPlatform,
): ShortcutAction | null => (
  SHORTCUT_ACTION_ORDER.find((action) => {
    const binding = resolveShortcutBinding(shortcutOptions, action, platform);
    return binding.enabled && isShortcutPhysicalMatch(event as KeyboardEvent, binding.combo);
  }) ?? null
);

export const resolveCloseShortcutKeydownDecision = ({
  event,
  shortcutOptions,
  platform,
  capturingShortcut,
  imeComposing,
  interactionBlocked,
}: {
  event: CloseShortcutKeyEvent;
  shortcutOptions: Partial<ShortcutOptions> | null | undefined;
  platform: ShortcutPlatform;
  capturingShortcut: boolean;
  imeComposing: boolean;
  interactionBlocked: boolean;
}): CloseShortcutKeydownDecision => {
  const nativeCloseMatched = isShortcutPhysicalMatch(
    event as KeyboardEvent,
    getPlatformNativeCloseCombo(platform),
  );
  const closeBinding = resolveShortcutBinding(shortcutOptions, 'closeActiveTab', platform);
  const configuredCloseMatched = closeBinding.enabled
    && isShortcutPhysicalMatch(event as KeyboardEvent, closeBinding.combo);

  if (!nativeCloseMatched && !configuredCloseMatched) {
    return { kind: 'ignore', preventDefault: false, stopImmediatePropagation: false };
  }
  if (capturingShortcut) {
    return { kind: 'recording', preventDefault: false, stopImmediatePropagation: false };
  }

  const ownerAction = resolvePhysicalShortcutOwner(event, shortcutOptions, platform);
  if (imeComposing || interactionBlocked) {
    return {
      kind: 'consume',
      preventDefault: true,
      stopImmediatePropagation: true,
      ownerAction,
    };
  }
  if (ownerAction === 'closeActiveTab') {
    return {
      kind: 'close',
      preventDefault: true,
      stopImmediatePropagation: true,
      ownerAction,
    };
  }
  if (ownerAction) {
    return {
      kind: 'delegate',
      preventDefault: true,
      stopImmediatePropagation: false,
      ownerAction,
    };
  }

  return {
    kind: 'consume',
    preventDefault: true,
    stopImmediatePropagation: true,
    ownerAction: null,
  };
};

type ClosestTarget = {
  closest?: (selector: string) => ClosestTarget | null;
  parentElement?: ClosestTarget | null;
  getAttribute?: (name: string) => string | null;
  hidden?: boolean;
  style?: {
    display?: string;
    visibility?: string;
  };
  classList?: {
    contains?: (name: string) => boolean;
  };
  ownerDocument?: {
    defaultView?: {
      getComputedStyle?: (element: unknown) => {
        display?: string;
        visibility?: string;
      };
    } | null;
  } | null;
};

type QueryDocument = {
  querySelectorAll?: (selector: string) => ArrayLike<ClosestTarget>;
};

const CLOSE_SHORTCUT_SCOPE_SELECTOR = '[data-gonavi-close-shortcut-scope]';

const DETACHED_CLOSE_SHORTCUT_SCOPE_SELECTOR = [
  '[data-gonavi-close-shortcut-scope="blocked"]',
  '.gn-detached-result-window',
  '.gn-detached-window',
  '.gn-detached-ai-chat-window',
  '.gn-result-diff-floating-window',
].join(', ');

export const CLOSE_SHORTCUT_GUARD_SELECTOR = [
  '[data-gonavi-close-shortcut-guard="true"]',
  '.ant-modal-wrap',
  '.ant-drawer',
  '.ant-dropdown',
  '.ant-select-dropdown',
  '.ant-picker-dropdown',
  '.ant-popover',
  '.gn-v2-table-context-menu-portal',
  '.gn-v2-sidebar-context-menu-portal',
  '.gn-v2-table-overview-context-menu-portal',
  '.gn-v2-redis-context-menu',
  '.gn-v2-context-menu',
].join(', ');

export const CLOSE_SHORTCUT_BACKGROUND_BLOCKER_SELECTOR = [
  '[data-gonavi-close-shortcut-blocks-background="true"]',
  '.ant-modal-wrap',
  '.ant-drawer.ant-drawer-open',
  '.ant-dropdown:not(.ant-dropdown-hidden)',
  '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  '.ant-popover:not(.ant-popover-hidden)',
  '.gn-v2-table-context-menu-portal',
  '.gn-v2-sidebar-context-menu-portal',
  '.gn-v2-table-overview-context-menu-portal',
  '.gn-v2-redis-context-menu',
  '.gn-v2-context-menu',
].join(', ');

const asClosestTarget = (target: EventTarget | ClosestTarget | null | undefined): ClosestTarget | null => {
  if (!target || typeof target !== 'object') return null;
  const candidate = target as ClosestTarget;
  if (typeof candidate.closest === 'function') return candidate;
  return candidate.parentElement && typeof candidate.parentElement.closest === 'function'
    ? candidate.parentElement
    : null;
};

const closest = (target: ClosestTarget | null, selector: string): ClosestTarget | null => {
  if (!target || typeof target.closest !== 'function') return null;
  return target.closest(selector);
};

export const resolveCloseShortcutScopeFromTarget = (
  target: EventTarget | ClosestTarget | null | undefined,
): CloseShortcutScope | null => {
  const element = asClosestTarget(target);
  if (!element) return null;

  if (closest(element, DETACHED_CLOSE_SHORTCUT_SCOPE_SELECTOR)) {
    return 'blocked';
  }
  if (closest(element, CLOSE_SHORTCUT_GUARD_SELECTOR)) {
    return null;
  }

  const scopeElement = closest(element, CLOSE_SHORTCUT_SCOPE_SELECTOR);
  const scope = scopeElement?.getAttribute?.('data-gonavi-close-shortcut-scope');
  return scope === 'workspace' || scope === 'result' || scope === 'blocked'
    ? scope
    : null;
};

export const isCloseShortcutGuardTarget = (
  target: EventTarget | ClosestTarget | null | undefined,
): boolean => Boolean(closest(asClosestTarget(target), CLOSE_SHORTCUT_GUARD_SELECTOR));

const isVisibleBlocker = (element: ClosestTarget): boolean => {
  if (element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
  if (
    element.classList?.contains?.('ant-dropdown-hidden')
    || element.classList?.contains?.('ant-select-dropdown-hidden')
    || element.classList?.contains?.('ant-picker-dropdown-hidden')
    || element.classList?.contains?.('ant-popover-hidden')
  ) {
    return false;
  }
  if (element.style?.display === 'none' || element.style?.visibility === 'hidden') return false;
  const computedStyle = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  return computedStyle?.display !== 'none' && computedStyle?.visibility !== 'hidden';
};

export const hasVisibleCloseShortcutBackgroundBlocker = (
  documentTarget: QueryDocument | null | undefined,
): boolean => {
  const elements = documentTarget?.querySelectorAll?.(CLOSE_SHORTCUT_BACKGROUND_BLOCKER_SELECTOR);
  if (!elements) return false;
  return Array.from(elements).some(isVisibleBlocker);
};

export const isCloseShortcutInteractionBlocked = (
  target: EventTarget | ClosestTarget | null | undefined,
  documentTarget: QueryDocument | null | undefined,
): boolean => (
  isCloseShortcutGuardTarget(target)
  || hasVisibleCloseShortcutBackgroundBlocker(documentTarget)
);

export const dispatchCloseActiveWorkspaceTab = (eventTarget: Window = window): void => {
  eventTarget.dispatchEvent(new CustomEvent(CLOSE_ACTIVE_WORKSPACE_TAB_EVENT));
};

export const dispatchCloseActiveResultTab = (
  targetTabId: string | null,
  eventTarget: Window = window,
): CloseActiveResultShortcutOutcome => {
  const request: CloseActiveResultShortcutRequest = {
    targetTabId,
    handled: false,
    outcome: 'ignored',
  };
  eventTarget.dispatchEvent(new CustomEvent<CloseActiveResultShortcutRequest>(
    CLOSE_ACTIVE_RESULT_TAB_EVENT,
    { detail: request },
  ));
  return request.outcome;
};
