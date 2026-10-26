const ITEM_SELECTOR = '[data-menu-item="true"]:not([aria-disabled="true"])';

const itemsWithin = (container: ParentNode): HTMLElement[] => Array.from(
  container.querySelectorAll<HTMLElement>(ITEM_SELECTOR),
).filter((item) => {
  const submenu = item.closest('.gn-zcode-provider-menu');
  if (!submenu) return true;
  return container instanceof Element && (container === submenu || container.contains(submenu) === false && submenu.contains(container));
});

const focusItem = (container: ParentNode, direction: 1 | -1 | 'first' | 'last'): void => {
  const items = itemsWithin(container);
  if (items.length === 0) return;
  const current = items.findIndex((item) => item === document.activeElement);
  const next = direction === 'first' || (current < 0 && direction === 1) ? 0
    : direction === 'last' || (current < 0 && direction === -1) ? items.length - 1
      : (current + direction + items.length) % items.length;
  items[next]?.focus();
};

export const handleComposerMenuKey = (
  event: { key: string; preventDefault: () => void; target: EventTarget | null; currentTarget: EventTarget | null },
  state: { providerOpen: boolean; narrow: boolean; submenu: HTMLElement | null },
  actions: { openProviders: () => void; closeProviders: () => void; closeMenu: () => void },
): void => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (state.providerOpen) actions.closeProviders();
    else actions.closeMenu();
    return;
  }
  const target = event.target;
  const providerTrigger = target instanceof Element && target.closest('[data-testid="composer-provider-trigger"]');
  if (event.key === 'ArrowRight' && !state.narrow && providerTrigger) {
    event.preventDefault();
    actions.openProviders();
    return;
  }
  if (event.key === 'ArrowLeft' && state.providerOpen && state.submenu?.contains(target instanceof Node ? target : null)) {
    event.preventDefault();
    actions.closeProviders();
    return;
  }
  const direction = event.key === 'ArrowDown' ? 1
    : event.key === 'ArrowUp' ? -1
      : event.key === 'Home' ? 'first'
        : event.key === 'End' ? 'last'
          : null;
  if (direction == null || !(event.currentTarget instanceof HTMLElement)) return;
  event.preventDefault();
  const submenuOwnsFocus = Boolean(state.submenu?.contains(target instanceof Node ? target : null));
  focusItem(submenuOwnsFocus && state.submenu ? state.submenu : event.currentTarget, direction);
};
