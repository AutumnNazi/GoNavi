/** @vitest-environment jsdom */

import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/provider';
import { useStore } from '../../store';
import TitlebarActionsPlacementSettings from '../settings/TitlebarActionsPlacementSettings';
import TitleBarQuickActionsHost from '../TitleBarQuickActionsHost';
import TitleBarActionRow, { type TitleBarActionRowProps } from './TitleBarActionRow';

// jsdom 环境替换了全局 URL，按字符串路径读取样式源码。
const rowCss = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'titleBarActionRow.css'), 'utf8');

const createHandlers = () => ({
  onNewQuery: vi.fn(),
  onNewConnection: vi.fn(),
  onManageConnectionGroups: vi.fn(),
  onToggleAI: vi.fn(),
});

const rowProps = (handlers: ReturnType<typeof createHandlers>, overrides: Partial<TitleBarActionRowProps> = {}): TitleBarActionRowProps => ({
  placement: 'toolbar',
  messageQueuePrimary: false,
  aiActive: false,
  ...handlers,
  ...overrides,
});

/** 与 App 相同的摆放：工具条模式在标题栏之外，标题栏模式内联到品牌区。Host 先于入口行渲染。 */
const PlacementHarness: React.FC<{ onSqlTools: () => void }> = ({ onSqlTools }) => {
  const placement = useStore((state) => state.appearance.titlebarActionsPlacement);
  const row = <TitleBarActionRow {...rowProps(createHandlers(), { placement })} />;
  return (
    <>
      <TitleBarQuickActionsHost label="Tools" actions={[{ key: 'sql-tools', label: 'SQL tools', onClick: onSqlTools }]} />
      <div className="gn-v2-titlebar">
        <div className="gonavi-titlebar-leading" data-testid="leading">
          <span>GoNavi</span>
          {placement === 'titlebar' && row}
        </div>
      </div>
      {placement !== 'titlebar' && row}
    </>
  );
};

describe('TitleBarActionRow', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    useStore.getState().setAppearance({ titlebarActionsPlacement: 'toolbar' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useStore.getState().setAppearance({ titlebarActionsPlacement: 'toolbar' });
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  const render = async (node: React.ReactNode) => {
    await act(async () => {
      root.render(
        <I18nProvider preference="en-US" systemLanguages={['en-US']} onPreferenceChange={vi.fn()}>
          {node}
        </I18nProvider>,
      );
    });
  };

  const button = (selector: string) => container.querySelector(selector) as HTMLButtonElement;

  it('renders the whole row inside the separate toolbar by default', async () => {
    const handlers = createHandlers();
    await render(<TitleBarActionRow {...rowProps(handlers, { newQueryShortcut: 'Ctrl+T' })} />);

    const toolbar = container.querySelector('[data-gonavi-titlebar-toolbar="true"]');
    expect(toolbar).not.toBeNull();
    expect(container.querySelector('[data-titlebar-actions-placement="titlebar"]')).toBeNull();
    expect(toolbar?.querySelector('#gonavi-titlebar-quick-actions')).not.toBeNull();
    expect(toolbar?.querySelectorAll('[data-titlebar-toolbar-icon]').length).toBe(4);
    expect(button('[data-gonavi-new-query-action="true"]').title).toBe('New Query · Ctrl+T');

    await act(async () => {
      button('[data-gonavi-create-connection-action="true"]').click();
      button('[data-gonavi-new-query-action="true"]').click();
      button('[data-gonavi-connection-group-management-action="true"]').click();
      button('[data-gonavi-ai-toolbar-action="true"]').click();
    });
    expect(handlers.onNewConnection).toHaveBeenCalledTimes(1);
    expect(handlers.onNewQuery).toHaveBeenCalledTimes(1);
    expect(handlers.onManageConnectionGroups).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleAI).toHaveBeenCalledTimes(1);
  });

  it('inlines the same entries without the toolbar when placed in the title bar', async () => {
    await render(
      <TitleBarActionRow
        {...rowProps(createHandlers(), { placement: 'titlebar', messageQueuePrimary: true, aiActive: true })}
        trailingSlot={<div id="gonavi-titlebar-about-action" />}
      />,
    );

    const inline = container.querySelector('.gonavi-titlebar-inline-actions[data-titlebar-actions-placement="titlebar"]');
    expect(inline).not.toBeNull();
    expect(container.querySelector('[data-gonavi-titlebar-toolbar="true"]')).toBeNull();
    expect(inline?.querySelector('[data-titlebar-primary-actions="true"]')).not.toBeNull();
    expect(inline?.querySelector('#gonavi-titlebar-quick-actions')).not.toBeNull();
    expect(inline?.querySelector('#gonavi-titlebar-about-action')).not.toBeNull();
    expect(button('[data-gonavi-ai-toolbar-action="true"]').getAttribute('aria-pressed')).toBe('true');
    expect(button('[data-gonavi-new-query-action="true"]').getAttribute('aria-label')).toBe('Message workbench');
  });

  it('hides toolbar icons only for the inline title bar row', () => {
    expect(rowCss).toMatch(/\.gonavi-titlebar-inline-actions\s*\{\s*display:\s*contents;\s*\}/);
    expect(rowCss).toMatch(
      /body\[data-ui-version='v2'\] \.gn-v2-titlebar \.gonavi-titlebar-inline-actions\[data-titlebar-actions-placement='titlebar'\] \.gn-titlebar-toolbar-item-icon\s*\{\s*display:\s*none;\s*\}/,
    );
  });

  it('moves the sidebar quick actions into the new slot when the placement switches at runtime', async () => {
    const onSqlTools = vi.fn();
    await render(<PlacementHarness onSqlTools={onSqlTools} />);
    const sqlTools = () => Array.from(document.querySelectorAll('[data-titlebar-quick-action="sql-tools"]'));

    expect(sqlTools()).toHaveLength(1);
    expect(sqlTools()[0].closest('[data-gonavi-titlebar-toolbar="true"]')).not.toBeNull();

    await act(async () => { useStore.getState().setAppearance({ titlebarActionsPlacement: 'titlebar' }); });
    expect(sqlTools()).toHaveLength(1);
    expect(sqlTools()[0].closest('[data-testid="leading"]')).not.toBeNull();
    expect(document.querySelector('[data-gonavi-titlebar-toolbar="true"]')).toBeNull();

    await act(async () => { useStore.getState().setAppearance({ titlebarActionsPlacement: 'toolbar' }); });
    expect(sqlTools()).toHaveLength(1);
    expect(sqlTools()[0].closest('[data-gonavi-titlebar-toolbar="true"]')).not.toBeNull();

    await act(async () => { (sqlTools()[0] as HTMLButtonElement).click(); });
    expect(onSqlTools).toHaveBeenCalledTimes(1);
  });

  it('switches the placement from the settings pills', async () => {
    await render(<TitlebarActionsPlacementSettings />);
    const pill = (value: string) => button(`[data-titlebar-actions-placement="${value}"]`);

    expect(pill('toolbar').getAttribute('aria-pressed')).toBe('true');
    expect(pill('titlebar').textContent).toBe('Title bar, next to GoNavi (text only)');

    await act(async () => { pill('titlebar').click(); });
    expect(useStore.getState().appearance.titlebarActionsPlacement).toBe('titlebar');
    expect(pill('titlebar').getAttribute('aria-pressed')).toBe('true');
    expect(pill('toolbar').getAttribute('aria-pressed')).toBe('false');
  });
});
