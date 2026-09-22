import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../../i18n/provider';
import AIChatSessionSwitcher, { collectBusyAISessionIds } from './AIChatSessionSwitcher';

const renderSwitcher = (busySessionIds: string[] = []) => renderToStaticMarkup(
  <I18nProvider preference="zh-CN" systemLanguages={['zh-CN']} onPreferenceChange={() => {}}>
    <AIChatSessionSwitcher
      sessions={[
        { id: 'session-a', title: 'gonavi_kingbase_lab · 语法错误' },
        { id: 'session-b', title: 'orders · 缺表' },
      ]}
      activeSessionId="session-a"
      busySessionIds={busySessionIds}
      onSelectSession={() => {}}
    />
  </I18nProvider>,
);

describe('AIChatSessionSwitcher', () => {
  it('lists every parallel session and marks the open one', () => {
    const markup = renderSwitcher(['session-b']);

    expect(markup).toContain('aria-label="切换并行会话"');
    expect(markup).toContain('gonavi_kingbase_lab · 语法错误');
    expect(markup).toContain('orders · 缺表');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('进行中');
  });

  it('stays hidden when there is only one session', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider preference="zh-CN" systemLanguages={['zh-CN']} onPreferenceChange={() => {}}>
        <AIChatSessionSwitcher
          sessions={[{ id: 'session-a', title: 'only' }]}
          activeSessionId="session-a"
          onSelectSession={() => {}}
        />
      </I18nProvider>,
    );

    expect(markup).toBe('');
  });

  it('collects sessions that still have a live run', () => {
    expect(collectBusyAISessionIds([
      { sessionId: 'session-a', state: 'running_model' },
      { sessionId: 'session-a', state: 'running_tool' },
      { sessionId: 'session-b', state: 'completed' },
      { sessionId: 'session-c', state: 'queued' },
    ])).toEqual(['session-a', 'session-c']);
  });
});
