import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t, type SupportedLanguage } from '../../i18n';
import type { AppTitleBarProps } from './AppTitleBar';

const languageState = vi.hoisted(() => ({ language: 'en-US' as SupportedLanguage }));
vi.mock('../../i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => t(key, undefined, languageState.language) }),
}));
vi.mock('antd', () => ({
  Tooltip: ({ title, children }: { title: string; children: React.ReactNode }) =>
    <span data-tooltip={title}>{children}</span>,
  Button: ({ children, icon, danger: _danger, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: React.ReactNode; danger?: boolean;
  }) => <button {...props}>{icon}{children}</button>,
}));
vi.mock('../../../wailsjs/runtime', () => ({ WindowMinimise: vi.fn() }));

import { AppTitleBar } from './AppTitleBar';

const props: AppTitleBarProps = {
  useNativeMacWindowControls: false,
  dockActionsInTitlebarBand: false,
  handleTitleBarDoubleClick: vi.fn(),
  titleBarHeight: 40,
  isWebRuntime: true,
  titleBarLayout: { actionHeight: 32, dividerHeight: 20, upperBandHeight: 40 } as AppTitleBarProps['titleBarLayout'],
  titleBarButtonWidth: 40,
  effectiveUiScale: 1,
  tokenFontSize: 12,
  titleBarActionsInline: false,
  titleBarActionRow: <></>,
  dockedSidebarActionsHost: null,
  titleBarSystemActionsNode: <></>,
  handleWebLogout: vi.fn(),
  titleBarToggleIconKey: 'restore',
  handleTitleBarWindowToggle: vi.fn(),
  handleApplicationQuitRequest: vi.fn(),
};
const titles: Record<SupportedLanguage, string> = {
  'zh-CN': '退出当前 Web 会话',
  'zh-TW': '登出目前的 Web 工作階段',
  'en-US': 'Sign out of the current web session',
  'ja-JP': '現在の Web セッションからログアウト',
  'de-DE': 'Aus der aktuellen Websitzung abmelden',
  'ru-RU': 'Выйти из текущего веб-сеанса',
};

describe('AppTitleBar web logout localization', () => {
  it.each(Object.entries(titles) as [SupportedLanguage, string][])(
    'renders the %s tooltip from the active provider', (language, title) => {
      languageState.language = language;
      const markup = renderToStaticMarkup(<AppTitleBar {...props} />);
      expect(markup).toContain(`data-tooltip="${title}"`);
      expect(markup).not.toContain('app.titlebar.web_logout');
    },
  );

  it('uses a changed provider language on the next render', () => {
    languageState.language = 'en-US';
    expect(renderToStaticMarkup(<AppTitleBar {...props} />)).toContain(titles['en-US']);
    languageState.language = 'de-DE';
    expect(renderToStaticMarkup(<AppTitleBar {...props} />)).toContain(titles['de-DE']);
  });
});
