import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { t as catalogTranslate } from '../i18n/catalog';

const source = readFileSync(new URL('./AIChatPanel.tsx', import.meta.url), 'utf8');
const testSource = readFileSync(new URL('./AIChatPanel.message-boundary.test.tsx', import.meta.url), 'utf8');
const boundarySource = readFileSync(new URL('./ai/AIMessageRenderBoundary.tsx', import.meta.url), 'utf8');
const conversationViewSource = readFileSync(new URL('./ai/AIChatPanelConversationView.tsx', import.meta.url), 'utf8');
const derivedStateSource = readFileSync(new URL('./ai/aiChatPanelDerivedState.ts', import.meta.url), 'utf8');

const REQUIRED_RENDER_BOUNDARY_KEYS = [
  'ai_chat.message.render_error.title',
  'ai_chat.message.render_error.body',
  'ai_chat.message.render_error.unknown',
  'ai_chat.message.render_error.retry',
  'ai_chat.message.render_error.delete',
] as const;

describe('AIChatPanel merge resolution', () => {
  it('clears conflict markers from the merged files', () => {
    expect(source).not.toMatch(/^<{7}|^={7}|^>{7}/m);
    expect(testSource).not.toMatch(/^<{7}|^={7}|^>{7}/m);
  });

  it('keeps dev split architecture while retaining render-boundary isolation', () => {
    expect(source).toContain("import AIChatPanelConversationView from './ai/AIChatPanelConversationView';");
    expect(source).toContain("import { useAIChatRuntimeResources } from './ai/useAIChatRuntimeResources';");
    expect(source).toMatch(/import\s*{[^}]*useAIChatStreamSubscription[^}]*}\s*from '\.\/ai\/useAIChatStreamSubscription';/s);
    expect(source).toContain("import { useAIChatLocalTools } from './ai/useAIChatLocalTools';");

    expect(boundarySource).toContain('class AIMessageRenderBoundary extends React.Component');
    expect(conversationViewSource).toContain("import AIMessageRenderBoundary from './AIMessageRenderBoundary';");
    expect(conversationViewSource).toContain('<AIMessageRenderBoundary');
    expect(source).toContain('onMessageRenderError={handleMessageRenderError}');
    expect(source).toContain('__gonaviLastAIMessageRenderError');
    expect(source).toContain('[AI Message Render Error]');
  });

  it('keeps render-boundary recovery chrome translated through catalog keys', () => {
    expect(boundarySource).toContain('useOptionalI18n()');
    expect(boundarySource).toContain("catalogTranslate('en-US'");
    for (const key of REQUIRED_RENDER_BOUNDARY_KEYS) {
      expect(catalogTranslate('en-US', key)).not.toBe(key);
      expect(catalogTranslate('zh-CN', key)).not.toBe(key);
      expect(boundarySource).toContain(key);
    }

    for (const oldCopy of [
      '这条 AI 消息渲染失败，已自动隔离',
      '其余对话仍可继续使用。你可以先删除这条异常消息，再继续操作。',
      '未知渲染错误',
      '重试渲染',
      '删除这条消息',
    ]) {
      expect(boundarySource).not.toContain(oldCopy);
    }
  });

  it('restores panel-level i18n orchestration for composer notices and send lifecycle text', () => {
    expect(source).toContain("import { useI18n } from '../i18n/provider';");
    expect(source).toContain("import type { AIComposerNoticeDescriptor } from '../utils/aiComposerNotice';");
    expect(source).toContain("import { buildAIComposerNotice } from '../utils/aiComposerNotice';");
    expect(source).toContain("const { t } = useI18n();");
    expect(source).toContain("const [composerNoticeState, setComposerNoticeState] = useState<AIComposerNoticeDescriptor | null>(null);");
    expect(source).toContain("buildAIComposerNotice(t, composerNoticeState) ?? runtimeComposerNotice");
    expect(source).toContain("setComposerNoticeState({ kind: 'missing_provider' });");
    expect(source).toContain("setComposerNoticeState({ kind: 'provider_incomplete', issues: readiness.issues });");
    expect(source).toContain("setComposerNoticeState({ kind: 'missing_model' });");
    expect(source).toContain('const chatMessages = [...messages, userMsg].map((message) => toAIRequestMessage(message, t));');
    expect(source).toContain('toAIRequestMessage(userMsg, t)');

    for (const key of [
      'ai_chat.panel.status.model_connecting',
      'ai_chat.panel.status.waking_engine',
      'ai_chat.panel.status.waiting_response',
      'ai_chat.panel.status.memory_summary',
      'ai_chat.panel.message.service_not_ready',
    ]) {
      expect(source).toContain(`t('${key}'`);
    }

    expect(source).not.toContain('buildMissingProviderNotice');
    expect(source).not.toContain('buildIncompleteProviderNotice');
    expect(source).not.toContain('buildMissingModelNotice');
  });

  it('keeps translated session and insight chrome in the panel layer instead of falling back to hardcoded copy', () => {
    expect(source).toContain("() => orderedAISessions.find((session) => session.id === sid)?.title || t('ai_chat.panel.session.default_title')");
    expect(source).toContain("title: session.title || t('ai_chat.panel.session.default_title')");
    expect(source).toContain('buildAIChatInsights({');
    expect(source).toContain('translate: t,');
    expect(derivedStateSource).toContain("translate('ai_chat.panel.insight.context.linked_title', { count: contextCount })");
    expect(derivedStateSource).toContain("translate('ai_chat.panel.insight.context.linked_body', { tables: tablePreview })");
    expect(derivedStateSource).toContain("translate('ai_chat.panel.insight.query.slowest_title', { duration: Math.round(slowest.duration).toLocaleString() })");
    expect(derivedStateSource).toContain("translate('ai_chat.panel.insight.status.recent_body', { count: recentLogs.length })");
    expect(derivedStateSource).toContain("translate('ai_chat.panel.insight.write.detected_title', { count: writeCount })");
    expect(source).not.toContain("|| '新对话'");
  });

  it('waits for the active producer before manual stop unlocks session actions', () => {
    const handleStopSource = source.match(
      /const handleStop = useCallback[\s\S]*?const handleCreateSession = useCallback/,
    )?.[0] || '';
    expect(handleStopSource).toContain('prepareAIChatStreamForTerminalAction({');
    expect(handleStopSource).not.toContain('Service.AIChatCancel(sid)');
    expect(handleStopSource).not.toContain('setSending(false);');
  });

  it('locks producer and pointer interactions during a native terminal handoff', () => {
    const retrySource = source.match(
      /const handleRetryMessage = useCallback[\s\S]*?useAIChatStreamSubscription\(/,
    )?.[0] || '';
    expect(retrySource).toContain('if (sending || interactionDisabled) return;');
    expect(retrySource).toMatch(/\[\s*sid,\s*sending,\s*interactionDisabled,/);
    expect(source).toContain('if ((!text && draftAttachments.length === 0) || sending || interactionDisabled) return;');
    expect(source).toContain('aria-busy={interactionDisabled}');
    expect(source).toContain("pointerEvents: interactionDisabled ? 'none' : undefined");
  });
});
