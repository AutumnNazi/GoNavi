export interface MenuRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface MenuPoint {
  top: number;
  left: number;
}

const MENU_GAP = 4;
const MENU_MARGIN = 8;
const SUBMENU_MARGIN = 12;

export const placeComposerMenu = (
  trigger: MenuRect,
  menu: MenuRect,
  viewportWidth: number,
  viewportHeight: number,
): MenuPoint => {
  let top = trigger.top - MENU_GAP - menu.height;
  if (top < MENU_MARGIN) {
    top = Math.max(MENU_MARGIN, Math.min(trigger.bottom + MENU_GAP, viewportHeight - menu.height - MENU_MARGIN));
  }
  let left = trigger.right - menu.width;
  if (left < MENU_MARGIN) left = MENU_MARGIN;
  if (left + menu.width > viewportWidth - MENU_MARGIN) {
    left = Math.max(MENU_MARGIN, viewportWidth - menu.width - MENU_MARGIN);
  }
  return { top, left };
};

// 子菜单顶边对齐父菜单顶边，优先贴在右侧并留 4px；右侧放不下时翻到左侧。
export const placeProviderSubmenu = (
  menu: MenuRect,
  submenu: MenuRect,
  viewportWidth: number,
  viewportHeight: number,
): MenuPoint => {
  let left = menu.right + MENU_GAP;
  if (left + submenu.width > viewportWidth - SUBMENU_MARGIN) {
    left = menu.left - MENU_GAP - submenu.width;
  }
  if (left < SUBMENU_MARGIN) left = SUBMENU_MARGIN;
  let top = menu.top;
  if (top + submenu.height > viewportHeight - SUBMENU_MARGIN) {
    top = Math.max(SUBMENU_MARGIN, viewportHeight - submenu.height - SUBMENU_MARGIN);
  }
  return { top, left };
};

export const isNarrowComposerViewport = (width: number): boolean => width <= 639;
