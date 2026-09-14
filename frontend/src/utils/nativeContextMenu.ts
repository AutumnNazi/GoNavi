const NATIVE_CONTEXT_MENU_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[role="textbox"]',
  '.monaco-editor',
  '[data-allow-native-context-menu="true"]',
].join(',');

/**
 * Only `wails dev` (Vite live frontend) keeps the WebView inspect menu.
 * Packaged latest and packaged `dev` channel builds still suppress it.
 */
export const isWailsDevNativeContextMenu = (isViteDev: boolean): boolean => isViteDev === true;

/**
 * Keep browser editing menus available while suppressing the browser menu on
 * ordinary application surfaces. Custom application menus still get a chance
 * to handle the event before the root fallback runs.
 */
export const shouldAllowNativeContextMenu = (
  target: EventTarget | null | undefined,
  options?: { allowDebugMenu?: boolean },
): boolean => {
  if (options?.allowDebugMenu) return true;
  let element = target as (Element & { parentElement?: Element | null }) | null | undefined;
  if (!element || typeof element.matches !== 'function') {
    element = element?.parentElement;
  }
  while (element) {
    if (element.matches(NATIVE_CONTEXT_MENU_SELECTOR)) return true;
    if (element.hasAttribute('contenteditable')) {
      return element.getAttribute('contenteditable') !== 'false';
    }
    element = element.parentElement;
  }
  return false;
};
