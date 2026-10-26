import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

import { isNarrowComposerViewport, placeComposerMenu, placeProviderSubmenu, type MenuRect } from './composerMenuPlacement';

const hiddenStyle: CSSProperties = { position: 'fixed', top: 0, left: 0, visibility: 'hidden', zIndex: 1300 };

const toRect = (rect: DOMRect): MenuRect => ({
  top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
});

const sameBox = (style: CSSProperties, top: number, left: number): boolean =>
  style.top === top && style.left === left && style.visibility === 'visible';

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export const useComposerMenuPlacement = (
  open: boolean,
  providerOpen: boolean,
  layoutKey: string,
  triggerRef: RefObject<HTMLButtonElement>,
  menuRef: RefObject<HTMLDivElement>,
  submenuRef: RefObject<HTMLDivElement>,
): { narrow: boolean; menuStyle: CSSProperties; submenuStyle: CSSProperties } => {
  const [narrow, setNarrow] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>(hiddenStyle);
  const [submenuStyle, setSubmenuStyle] = useState<CSSProperties>(hiddenStyle);

  useClientLayoutEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const place = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const nextNarrow = isNarrowComposerViewport(window.innerWidth)
        || (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches);
      setNarrow(nextNarrow);
      const menuPoint = placeComposerMenu(toRect(trigger.getBoundingClientRect()), toRect(menu.getBoundingClientRect()), window.innerWidth, window.innerHeight);
      setMenuStyle((current) => (sameBox(current, menuPoint.top, menuPoint.left) ? current : {
        position: 'fixed', top: menuPoint.top, left: menuPoint.left, visibility: 'visible', zIndex: 1300,
      }));
      const submenu = submenuRef.current;
      if (!providerOpen || nextNarrow || !submenu) return;
      const subPoint = placeProviderSubmenu(toRect(menu.getBoundingClientRect()), toRect(submenu.getBoundingClientRect()), window.innerWidth, window.innerHeight);
      setSubmenuStyle((current) => (sameBox(current, subPoint.top, subPoint.left) ? current : {
        position: 'fixed', top: subPoint.top, left: subPoint.left, visibility: 'visible', zIndex: 1301,
      }));
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (menuRef.current) observer?.observe(menuRef.current);
    if (submenuRef.current) observer?.observe(submenuRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, providerOpen, layoutKey, triggerRef, menuRef, submenuRef]);

  return { narrow, menuStyle, submenuStyle };
};
