export const BOOT_SPLASH_ID = 'gonavi-boot-splash';

const readNavigatorLanguage = (): string => {
  if (typeof navigator === 'undefined') return '';
  return String(navigator.language || '');
};

const readUserAgent = (): string => {
  if (typeof navigator === 'undefined') return '';
  return String(navigator.userAgent || '');
};

export const isWindowsUserAgent = (userAgent = readUserAgent()): boolean => /Win/i.test(userAgent);

export const resolveBootSplashErrorMessage = (
  detail: string,
  language = readNavigatorLanguage(),
  windowsHost = isWindowsUserAgent(),
): string => {
  const isZh = String(language || '').toLowerCase().startsWith('zh');
  const trimmed = String(detail || '').trim();
  if (windowsHost) {
    const prefix = isZh
      ? '界面未能加载。若窗口长期空白，请安装 Microsoft Edge WebView2 运行时后重试。'
      : 'The UI failed to load. If the window stays blank, install the Microsoft Edge WebView2 Runtime and retry.';
    return trimmed ? `${prefix}\n${trimmed}` : prefix;
  }
  const prefix = isZh ? '界面未能加载。' : 'The UI failed to load.';
  return trimmed ? `${prefix}\n${trimmed}` : prefix;
};

type SplashHost = {
  getElementById?: (id: string) => unknown;
};

type SplashElement = {
  setAttribute?: (name: string, value: string) => void;
  removeAttribute?: (name: string) => void;
  querySelector?: (selector: string) => { textContent?: string | null } | null;
};

const asSplashElement = (value: unknown): SplashElement | null => {
  if (!value || typeof value !== 'object') return null;
  const element = value as SplashElement;
  if (typeof element.setAttribute !== 'function') return null;
  return element;
};

const readSplashDocument = (
  doc: SplashHost | null | undefined,
): SplashHost | undefined => {
  if (doc) return doc;
  if (typeof document === 'undefined') return undefined;
  return document;
};

export const hideBootSplash = (doc?: SplashHost | null): void => {
  const splash = asSplashElement(readSplashDocument(doc)?.getElementById?.(BOOT_SPLASH_ID));
  if (!splash) return;
  splash.setAttribute?.('hidden', '');
  splash.setAttribute?.('data-state', 'hidden');
  splash.setAttribute?.('aria-hidden', 'true');
};

export const showBootSplashError = (
  detail: string,
  doc?: SplashHost | null,
  language = readNavigatorLanguage(),
  windowsHost = isWindowsUserAgent(),
): void => {
  const splash = asSplashElement(readSplashDocument(doc)?.getElementById?.(BOOT_SPLASH_ID));
  if (!splash) return;
  splash.removeAttribute?.('hidden');
  splash.setAttribute?.('data-state', 'error');
  splash.setAttribute?.('aria-hidden', 'false');
  const message = splash.querySelector?.('[data-boot-message]');
  if (message) {
    message.textContent = resolveBootSplashErrorMessage(detail, language, windowsHost);
  }
};
