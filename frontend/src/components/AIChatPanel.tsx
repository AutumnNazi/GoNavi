import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import type { OverlayWorkbenchTheme } from '../utils/overlayWorkbenchTheme';
import type {
    AIChatAttachment,
    AIChatMessage,
    JVMAIPlanContext,
    JVMDiagnosticPlanContext,
} from '../types';
import './AIChatPanel.css';
import '../styles/v2-theme-ai.css';

import { AIChatHeader } from './ai/AIChatHeader';
import { AIChatInput } from './ai/AIChatInput';
import { AIHistoryDrawer } from './ai/AIHistoryDrawer';
import AIChatPanelConversationView from './ai/AIChatPanelConversationView';
import {
    prepareAIChatStreamForTerminalAction,
    useAIChatStreamSubscription,
} from './ai/useAIChatStreamSubscription';
import { buildRpcConnectionConfig } from '../utils/connectionRpcConfig';
import type { AIComposerNoticeDescriptor } from '../utils/aiComposerNotice';
import { buildAIComposerNotice } from '../utils/aiComposerNotice';
import { consumeAIChatSendShortcutOnKeyDown } from '../utils/aiChatSendShortcut';
import { toAIRequestMessage } from '../utils/aiMessagePayload';
import { compressContextIfNeeded, getDynamicMaxContextChars } from '../utils/aiChatRuntime';
import { getShortcutPlatform, resolveShortcutBinding } from '../utils/shortcuts';
import { isMacLikePlatform } from '../utils/appearance';
import { buildAvailableAIChatTools } from '../utils/aiToolRegistry';
import {
    buildAIChatInsights,
    buildAIChatInlineHistorySessions,
    calculateAIContextUsageChars,
    collectAIChatContextTableNames,
    inferAIChatConnectionContext,
    resolveAIChatPanelMode,
} from './ai/aiChatPanelDerivedState';
import { dispatchAIChatPayload } from './ai/aiChatPayloadDispatch';
import { buildAIChatReadinessSnapshot } from './ai/aiChatReadiness';
import { buildAISystemContextMessages } from './ai/aiSystemContextMessages';
import { useAIChatRuntimeResources } from './ai/useAIChatRuntimeResources';
import { useAIChatAutoContext } from './ai/useAIChatAutoContext';
import { useAIChatPanelResize } from './ai/useAIChatPanelResize';
import { useAIChatPlanContexts } from './ai/useAIChatPlanContexts';
import { useAIChatSessionState } from './ai/useAIChatSessionState';
import { useAIChatSessionTitleGenerator } from './ai/useAIChatSessionTitleGenerator';
import { useAIChatLocalTools } from './ai/useAIChatLocalTools';
import { useWorkbenchTabs } from '../hooks/useWorkbenchTabs';
import { resolveLiveQueryTabs } from '../utils/liveQueryTabs';
import { useI18n } from '../i18n/provider';
import {
    coerceThinkingIntensityForProfile,
    defaultThinkingIntensityForProfile,
    resolveThinkingIntensityProfile,
} from '../utils/aiThinkingIntensity';

interface AIChatPanelProps {
    width?: number;
    darkMode: boolean;
    bgColor?: string;
    onClose: () => void;
    onOpenSettings?: () => void;
    onWidthChange?: (width: number) => void;
    overlayTheme: OverlayWorkbenchTheme;
    /** dock：侧栏；detached：独立浮动窗内 */
    presentation?: 'dock' | 'detached';
    onDetach?: () => void;
    onAttach?: () => void;
    onRegisterTerminalGuard?: (guard: (() => Promise<boolean>) | null) => void;
    interactionDisabled?: boolean;
    /** 独立窗：从标题栏发起拖拽（按钮区域会 stopPropagation） */
    onWindowDragStart?: (event: React.PointerEvent) => void;
}

const genId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const AIChatPanel: React.FC<AIChatPanelProps> = ({
    width = 380, darkMode, bgColor, onClose, onOpenSettings, onWidthChange, overlayTheme,
    presentation = 'dock', onDetach, onAttach, onRegisterTerminalGuard,
    interactionDisabled = false, onWindowDragStart,
}) => {
    const { t } = useI18n();
    const [input, setInput] = useState('');
    const [draftAttachments, setDraftAttachments] = useState<AIChatAttachment[]>([]);
    const [sending, setSending] = useState(false);
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [activePanelMode, setActivePanelMode] = useState<'chat' | 'insights' | 'history'>('chat');
    const [composerNoticeState, setComposerNoticeState] = useState<AIComposerNoticeDescriptor | null>(null);
    const [thinkingIntensity, setThinkingIntensity] = useState('medium');
    const {
        activeProvider,
        composerNotice: runtimeComposerNotice,
        dynamicModels,
        fetchDynamicModels,
        handleComposerAction,
        handleModelChange,
        handleOpenSettingsFromPanel,
        loadingModels,
        mcpTools,
        skills,
        userPromptSettings,
    } = useAIChatRuntimeResources({ onOpenSettings });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const nudgeCountRef = useRef(0);
    const {
        getCurrentJVMPlanContext,
        getCurrentJVMDiagnosticPlanContext,
        pendingJVMPlanContextRef,
        pendingJVMDiagnosticPlanContextRef,
    } = useAIChatPlanContexts();

    const aiActiveSessionId = useStore(state => state.aiActiveSessionId);
    const appearance = useStore(state => state.appearance);
    const createNewAISession = useStore(state => state.createNewAISession);
    const addAIChatMessage = useStore(state => state.addAIChatMessage);
    const updateAIChatMessage = useStore(state => state.updateAIChatMessage);
    const deleteAIChatMessage = useStore(state => state.deleteAIChatMessage);
    const truncateAIChatMessages = useStore(state => state.truncateAIChatMessages);
    const updateAISessionTitle = useStore(state => state.updateAISessionTitle);

    const activeContext = useStore(state => state.activeContext);
    const aiContexts = useStore(state => state.aiContexts);
    const connections = useStore(state => state.connections);
    const tabs = useWorkbenchTabs();
    const activeTabId = useStore(state => state.activeTabId);
    const sqlLogs = useStore(state => state.sqlLogs);
    const setAIActiveSessionId = useStore(state => state.setAIActiveSessionId);
    const aiPanelVisible = useStore(state => state.aiPanelVisible);
    const isV2Ui = appearance.uiVersion === 'v2';
    const activeShortcutPlatform = getShortcutPlatform(isMacLikePlatform());
    const {
        ghostRef,
        handleResizeStart,
        isResizing,
        panelRect,
        panelRef,
        panelWidth,
    } = useAIChatPanelResize({
        width,
        isV2Ui,
        onWidthChange,
    });
    const availableTools = useMemo(
        () => buildAvailableAIChatTools(mcpTools, t),
        [mcpTools, t],
    );
    const aiChatSendShortcutBinding = useStore(state => resolveShortcutBinding(
        state.shortcutOptions,
        'sendAIChatMessage',
        activeShortcutPlatform,
    ));
    const { sid, messages, orderedAISessions } = useAIChatSessionState({
        aiActiveSessionId,
        aiPanelVisible,
        createNewAISession,
    });

    useAIChatAutoContext({
        aiPanelVisible,
        activeTabId,
        tabs,
    });

    useEffect(() => {
        if (runtimeComposerNotice) {
            setComposerNoticeState(null);
        }
    }, [runtimeComposerNotice]);

    // 切换供应商/模型时，将思考强度钳制到当前体系合法档位。
    useEffect(() => {
        if (!activeProvider) {
            return;
        }
        const profile = resolveThinkingIntensityProfile({
            type: activeProvider.type,
            apiFormat: activeProvider.apiFormat,
            baseUrl: activeProvider.baseUrl,
            model: activeProvider.model,
        });
        setThinkingIntensity((current) => {
            const next = coerceThinkingIntensityForProfile(
                current || defaultThinkingIntensityForProfile(profile),
                profile,
            );
            return next;
        });
    }, [
        activeProvider?.type,
        activeProvider?.apiFormat,
        activeProvider?.baseUrl,
        activeProvider?.model,
    ]);

    const getConnectionName = useCallback(() => {
        let connectionId = activeContext?.connectionId;
        if (!connectionId) {
            const activeTab = tabs.find(tab => tab.id === activeTabId);
            connectionId = activeTab?.connectionId;
        }
        if (!connectionId) return '';
        const connection = connections.find(item => item.id === connectionId);
        return connection ? connection.name : '';
    }, [activeContext, activeTabId, connections, tabs]);

    const activeConnName = getConnectionName();
    const composerNotice = useMemo(
        () => buildAIComposerNotice(t, composerNoticeState) ?? runtimeComposerNotice,
        [composerNoticeState, runtimeComposerNotice, t],
    );

    const textColor = overlayTheme.titleText;
    const mutedColor = overlayTheme.mutedText;
    const borderColor = overlayTheme.divider;
    const quickActionBg = darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.8)';
    const quickActionBorder = overlayTheme.sectionBorder;

    useEffect(() => {
        if (messages.length === 0) return;
        messagesEndRef.current?.scrollIntoView({ behavior: sending ? 'auto' : 'smooth', block: 'end' });
    }, [messages.length, sending]);

    useEffect(() => {
        const timer = setTimeout(() => {
            textareaRef.current?.focus();
        }, 100);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail?.prompt) {
                setInput(detail.prompt);
                setTimeout(() => {
                    textareaRef.current?.focus();
                }, 50);
            }
        };
        window.addEventListener('gonavi:ai:inject-prompt', handler);
        return () => window.removeEventListener('gonavi:ai:inject-prompt', handler);
    }, []);

    const generateTitleForSession = useAIChatSessionTitleGenerator({ updateAISessionTitle });

    const handleScrollMessages = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
        setShowScrollBottom(!isNearBottom);
    }, []);

    const scrollToMessagesBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    const handleEditMessage = useCallback((msg: AIChatMessage) => {
        truncateAIChatMessages(sid, msg.id);
        deleteAIChatMessage(sid, msg.id);
        setInput(msg.content);
        setDraftAttachments(msg.attachments || []);
        setTimeout(() => textareaRef.current?.focus(), 50);
    }, [sid, truncateAIChatMessages, deleteAIChatMessage]);

    const buildSystemContextMessages = useCallback((
        overrideJVMPlanContext?: JVMAIPlanContext,
        overrideJVMDiagnosticPlanContext?: JVMDiagnosticPlanContext,
    ) => {
        const { activeContext, aiContexts, connections, tabs, activeTabId } = useStore.getState();
        return buildAISystemContextMessages({
            activeContext,
            aiContexts,
            connections,
            tabs: resolveLiveQueryTabs(tabs),
            activeTabId,
            availableToolNames: availableTools.map((tool) => tool.function.name),
            skills,
            userPromptSettings,
            overrideJVMPlanContext,
            overrideJVMDiagnosticPlanContext,
            translate: t,
        });
    }, [availableTools, skills, t, userPromptSettings]);

    const {
        executeLocalTools,
        resetToolCallState,
        toolContextMapRef,
    } = useAIChatLocalTools({
        sid,
        activeProviderModel: activeProvider?.model,
        availableTools,
        buildSystemContextMessages,
        dynamicModels,
        mcpTools,
        nextMessageId: genId,
        pendingJVMPlanContextRef,
        pendingJVMDiagnosticPlanContextRef,
        setSending,
        skills,
        translate: t,
        updateAIChatMessage,
        userPromptSettings,
    });

    const handleRetryMessage = useCallback(async (msg: AIChatMessage) => {
        if (sending || interactionDisabled) return;
        const historyLocal = useStore.getState().aiChatHistory[sid] || [];
        const aiIndex = historyLocal.findIndex(message => message.id === msg.id);
        if (aiIndex <= 0) return;

        let lastUserMsgIndex = -1;
        for (let i = aiIndex - 1; i >= 0; i--) {
            if (historyLocal[i].role === 'user') {
                lastUserMsgIndex = i;
                break;
            }
        }

        if (lastUserMsgIndex >= 0) {
            const userMsg = historyLocal[lastUserMsgIndex];
            truncateAIChatMessages(sid, userMsg.id);

            resetToolCallState();
            nudgeCountRef.current = 0;
            const retryJVMPlanContext = msg.jvmPlanContext || getCurrentJVMPlanContext();
            const retryJVMDiagnosticPlanContext =
                msg.jvmDiagnosticPlanContext || getCurrentJVMDiagnosticPlanContext();
            pendingJVMPlanContextRef.current = retryJVMPlanContext;
            pendingJVMDiagnosticPlanContextRef.current = retryJVMDiagnosticPlanContext;

            setSending(true);

            const connectingMsg: AIChatMessage = {
                id: genId(),
                role: 'assistant',
                phase: 'connecting',
                content: '',
                timestamp: Date.now(),
                loading: true,
                jvmPlanContext: retryJVMPlanContext,
                jvmDiagnosticPlanContext: retryJVMDiagnosticPlanContext,
            };
            addAIChatMessage(sid, connectingMsg);

            const truncatedHistory = historyLocal.slice(0, lastUserMsgIndex + 1);
            const messagesPayload = truncatedHistory.map((message) => toAIRequestMessage(message, t));

            try {
                const sysMessages = await buildSystemContextMessages(
                    retryJVMPlanContext,
                    retryJVMDiagnosticPlanContext,
                );
                const allMessages = [...sysMessages, ...messagesPayload];
                await dispatchAIChatPayload({
                    sid,
                    messages: allMessages,
                    tools: availableTools,
                    addAIChatMessage,
                    updateAIChatMessage,
                    setSending,
                    nextMessageId: genId,
                    pendingAssistantMessageId: connectingMsg.id,
                    jvmPlanContext: retryJVMPlanContext,
                    jvmDiagnosticPlanContext: retryJVMDiagnosticPlanContext,
                    translate: t,
                });
            } catch {
                setSending(false);
            }
        }
    }, [
        sid,
        sending,
        interactionDisabled,
        availableTools,
        buildSystemContextMessages,
        truncateAIChatMessages,
        addAIChatMessage,
        getCurrentJVMPlanContext,
        getCurrentJVMDiagnosticPlanContext,
        resetToolCallState,
        t,
        updateAIChatMessage,
    ]);

    useAIChatStreamSubscription({
        sid,
        sending,
        setSending,
        availableTools,
        addAIChatMessage,
        updateAIChatMessage,
        buildSystemContextMessages,
        executeLocalTools,
        generateTitleForSession,
        nextMessageId: genId,
        nudgeCountRef,
        pendingJVMPlanContextRef,
        pendingJVMDiagnosticPlanContextRef,
        translate: t,
    });

    const handleSend = useCallback(async () => {
        const text = input.trim();
        if ((!text && draftAttachments.length === 0) || sending || interactionDisabled) return;

        const connectionKey = activeContext?.connectionId ? `${activeContext.connectionId}:${activeContext.dbName || ''}` : 'default';
        const readiness = buildAIChatReadinessSnapshot({
            activeProvider,
            dynamicModels,
            loadingModels,
            activeContext,
            activeContextItems: aiContexts[connectionKey] || [],
        });

        if (readiness.status === 'missing_provider') {
            setComposerNoticeState({ kind: 'missing_provider' });
            return;
        }
        if (readiness.status === 'provider_incomplete') {
            setComposerNoticeState({ kind: 'provider_incomplete', issues: readiness.issues });
            return;
        }
        if (readiness.status === 'missing_model' || readiness.status === 'loading_models') {
            setComposerNoticeState({ kind: 'missing_model' });
            return;
        }
        setComposerNoticeState(null);

        resetToolCallState();
        nudgeCountRef.current = 0;
        const currentJVMPlanContext = getCurrentJVMPlanContext();
        const currentJVMDiagnosticPlanContext = getCurrentJVMDiagnosticPlanContext();
        pendingJVMPlanContextRef.current = currentJVMPlanContext;
        pendingJVMDiagnosticPlanContextRef.current = currentJVMDiagnosticPlanContext;

        const currentAttachments = [...draftAttachments];
        const currentImages = currentAttachments
            .filter((attachment) => attachment.kind === 'image' && attachment.dataUrl)
            .map((attachment) => attachment.dataUrl as string);
        const currentFileAttachments = currentAttachments.filter((attachment) => attachment.kind !== 'image');
        setInput('');
        setDraftAttachments([]);
        setSending(true);

        textareaRef.current?.focus();

        const userMsg: AIChatMessage = {
            id: genId(),
            role: 'user',
            content: text,
            timestamp: Date.now(),
            images: currentImages.length > 0 ? currentImages : undefined,
            attachments: currentFileAttachments.length > 0 ? currentFileAttachments : undefined,
        };
        addAIChatMessage(sid, userMsg);

        const connectingMsg: AIChatMessage = {
            id: genId(),
            role: 'assistant',
            phase: 'connecting',
            content: '',
            timestamp: Date.now(),
            loading: true,
            jvmPlanContext: currentJVMPlanContext,
            jvmDiagnosticPlanContext: currentJVMDiagnosticPlanContext,
        };
        addAIChatMessage(sid, connectingMsg);

        const systemMessages = await buildSystemContextMessages(
            currentJVMPlanContext,
            currentJVMDiagnosticPlanContext,
        );

        updateAIChatMessage(sid, connectingMsg.id, { content: t('ai_chat.panel.status.model_connecting') });

        const chatMessages = [...messages, userMsg].map((message) => toAIRequestMessage(message, t));

        let finalMessagesPayload = chatMessages;
        const dynamicMaxLimit = getDynamicMaxContextChars(activeProvider?.model);
        const summary = await compressContextIfNeeded(sid, chatMessages, dynamicMaxLimit, t);
        if (summary) {
            const compressedMsg: AIChatMessage = {
                id: genId(),
                role: 'assistant',
                content: t('ai_chat.panel.status.memory_summary', { summary }),
                timestamp: Date.now() - 1000,
            };
            useStore.getState().replaceAIChatHistory(sid, [compressedMsg, userMsg, connectingMsg]);
            finalMessagesPayload = [
                { role: 'assistant', content: compressedMsg.content },
                toAIRequestMessage(userMsg, t),
            ];
        }

        const allMessages = [...systemMessages, ...finalMessagesPayload];

        updateAIChatMessage(sid, connectingMsg.id, { content: t('ai_chat.panel.status.waking_engine') });
        updateAIChatMessage(sid, connectingMsg.id, { content: t('ai_chat.panel.status.waiting_response') });

        await dispatchAIChatPayload({
            sid,
            messages: allMessages,
            tools: availableTools,
            sendOptions: {
                model: String(activeProvider?.model || '').trim() || undefined,
                thinkingIntensity: String(thinkingIntensity || '').trim() || undefined,
            },
            addAIChatMessage,
            updateAIChatMessage,
            setSending,
            nextMessageId: genId,
            pendingAssistantMessageId: connectingMsg.id,
            jvmPlanContext: currentJVMPlanContext,
            jvmDiagnosticPlanContext: currentJVMDiagnosticPlanContext,
            unavailableContent: t('ai_chat.panel.message.service_not_ready'),
            translate: t,
            onNonStreamSuccess: messages.length === 0
                ? () => generateTitleForSession(sid)
                : undefined,
        });
    }, [
        input,
        draftAttachments,
        sending,
        interactionDisabled,
        messages,
        addAIChatMessage,
        sid,
        activeContext,
        activeProvider,
        aiContexts,
        availableTools,
        buildSystemContextMessages,
        dynamicModels,
        generateTitleForSession,
        getCurrentJVMPlanContext,
        getCurrentJVMDiagnosticPlanContext,
        loadingModels,
        resetToolCallState,
        t,
        thinkingIntensity,
        updateAIChatMessage,
    ]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
        consumeAIChatSendShortcutOnKeyDown(aiChatSendShortcutBinding, event, handleSend);
    }, [aiChatSendShortcutBinding, handleSend]);

    const handleStop = useCallback(async () => {
        try {
            const Service = (window as any).go?.aiservice?.Service;
            const stopped = await prepareAIChatStreamForTerminalAction({
                sid,
                service: Service,
                setSending,
            });
            if (!stopped) {
                console.warn('Chat stream did not stop before the cancellation timeout');
            }
        } catch (error) {
            console.warn('Failed to stop chat stream', error);
        }
    }, [sid]);

    const handleCreateSession = useCallback(() => {
        if (sending || interactionDisabled) return;
        createNewAISession();
        setActivePanelMode('chat');
    }, [createNewAISession, interactionDisabled, sending]);

    const handleSelectSession = useCallback((sessionId: string) => {
        if (sending || interactionDisabled) return;
        setAIActiveSessionId(sessionId);
        setActivePanelMode('chat');
        setHistoryOpen(false);
    }, [interactionDisabled, sending, setAIActiveSessionId]);

    const prepareForTerminalAction = useCallback(async () => {
        const Service = (window as any).go?.aiservice?.Service;
        return prepareAIChatStreamForTerminalAction({
            sid,
            service: Service,
            setSending,
            allSessions: true,
        });
    }, [sid]);

    useEffect(() => {
        onRegisterTerminalGuard?.(prepareForTerminalAction);
        return () => onRegisterTerminalGuard?.(null);
    }, [onRegisterTerminalGuard, prepareForTerminalAction]);

    const { inferredConnectionId, inferredDbName } = useMemo(
        () => inferAIChatConnectionContext({
            activeConnectionId: activeContext?.connectionId,
            activeDbName: activeContext?.dbName,
            messages,
            toolContextEntries: toolContextMapRef.current.values(),
        }),
        [activeContext?.connectionId, activeContext?.dbName, messages],
    );

    const handleDeleteMessage = useCallback((id: string) => deleteAIChatMessage(sid, id), [sid, deleteAIChatMessage]);
    const handleMessageRenderError = useCallback((error: Error, errorInfo: React.ErrorInfo, msg: AIChatMessage) => {
        console.error('[AI Message Render Error]', msg.id, error, errorInfo);
        const renderErrorPayload = {
            messageId: msg.id,
            role: msg.role,
            contentPreview: String(msg.content || '').slice(0, 240),
            message: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack,
            recordedAt: Date.now(),
        };
        if (typeof window !== 'undefined') {
            (window as any).__gonaviLastAIMessageRenderError = renderErrorPayload;
        }
        (globalThis as any).__gonaviLastAIMessageRenderError = renderErrorPayload;
    }, []);
    const currentSessionTitle = useMemo(
        () => orderedAISessions.find((session) => session.id === sid)?.title || t('ai_chat.panel.session.default_title'),
        [orderedAISessions, sid, t],
    );
    const activeConnectionConfig = useMemo(() => {
        if (!inferredConnectionId) return undefined;
        const connection = connections.find(item => item.id === inferredConnectionId);
        return connection ? buildRpcConnectionConfig(connection.config) : undefined;
    }, [inferredConnectionId, connections]);
    const contextUsageChars = useMemo(
        () => calculateAIContextUsageChars(messages),
        [messages],
    );
    const contextTableNames = useMemo(
        () => collectAIChatContextTableNames({
            aiContexts,
            activeConnectionId: activeContext?.connectionId,
            activeDbName: activeContext?.dbName,
        }),
        [activeContext?.connectionId, activeContext?.dbName, aiContexts],
    );
    const aiInsights = useMemo(() => {
        return buildAIChatInsights({
            contextTableNames,
            sqlLogs,
            translate: t,
        });
    }, [contextTableNames, sqlLogs, t]);
    const panelHistorySessions = useMemo(
        () => buildAIChatInlineHistorySessions(
            orderedAISessions.map((session) => ({
                ...session,
                title: session.title || t('ai_chat.panel.session.default_title'),
            })),
        ),
        [orderedAISessions, t],
    );
    const effectivePanelMode = useMemo(
        () => resolveAIChatPanelMode(isV2Ui, activePanelMode),
        [activePanelMode, isV2Ui],
    );

    const handleComposerActionWithNoticeReset = useCallback((actionKey: 'open-settings' | 'reload-models') => {
        setComposerNoticeState(null);
        handleComposerAction(actionKey);
    }, [handleComposerAction]);

    const handleModelChangeWithNoticeReset = useCallback((model: string) => {
        setComposerNoticeState(null);
        void handleModelChange(model);
    }, [handleModelChange]);

    const isDetachedPresentation = presentation === 'detached';

    return (
        <div
            ref={panelRef}
            className={`ai-chat-panel${isV2Ui ? ' gn-v2-ai-panel' : ''}${isDetachedPresentation ? ' is-detached' : ''}`}
            aria-busy={interactionDisabled}
            style={{
                width: isDetachedPresentation ? '100%' : panelWidth,
                height: isDetachedPresentation ? '100%' : undefined,
                background: bgColor || 'transparent',
                color: textColor,
                borderLeft: isDetachedPresentation ? 'none' : overlayTheme.shellBorder,
                position: 'relative',
                pointerEvents: interactionDisabled ? 'none' : undefined,
            }}
        >
            {!isDetachedPresentation && (
                <div className={`ai-resize-handle${isResizing ? ' active' : ''}`} onMouseDown={handleResizeStart} />
            )}

            {!isDetachedPresentation && isResizing && panelRect.current && createPortal(
                <div
                    ref={ghostRef}
                    style={{
                        position: 'fixed',
                        top: panelRect.current.top,
                        bottom: panelRect.current.bottom,
                        left: panelRect.current.left,
                        width: '2px',
                        background: darkMode ? '#ffd666' : '#1677ff',
                        zIndex: 99999,
                        pointerEvents: 'none'
                    }}
                />,
                document.body
            )}

            <AIChatHeader
                darkMode={darkMode}
                mutedColor={mutedColor}
                textColor={textColor}
                overlayTheme={overlayTheme}
                isV2Ui={isV2Ui}
                presentation={presentation}
                onHistoryClick={() => {
                    if (isV2Ui) {
                        setActivePanelMode('history');
                    } else {
                        setHistoryOpen(true);
                    }
                }}
                onClear={() => {
                    handleCreateSession();
                }}
                onSettingsClick={handleOpenSettingsFromPanel}
                onClose={onClose}
                onDetach={onDetach}
                onAttach={onAttach}
                onWindowDragStart={onWindowDragStart}
                sessionTitle={currentSessionTitle}
                activeMode={effectivePanelMode}
                onModeChange={(mode) => {
                    if (!isV2Ui) return;
                    setActivePanelMode(mode);
                    if (mode === 'history') {
                        setHistoryOpen(false);
                    }
                }}
            />

            <AIChatPanelConversationView
                mode={effectivePanelMode}
                messages={messages}
                darkMode={darkMode}
                overlayTheme={overlayTheme}
                textColor={textColor}
                mutedColor={mutedColor}
                quickActionBg={quickActionBg}
                quickActionBorder={quickActionBorder}
                showScrollBottom={showScrollBottom}
                contextTableNames={contextTableNames}
                isV2Ui={isV2Ui}
                insights={aiInsights}
                sessions={panelHistorySessions}
                activeSessionId={sid}
                sessionActionsDisabled={sending || interactionDisabled}
                activeConnectionId={inferredConnectionId}
                activeConnectionConfig={activeConnectionConfig}
                activeDbName={inferredDbName}
                messagesEndRef={messagesEndRef}
                onScrollMessages={handleScrollMessages}
                onQuickAction={(prompt: string, autoSend?: boolean) => {
                    setInput(prompt);
                    if (autoSend) {
                        window.setTimeout(() => {
                            textareaRef.current?.focus();
                        }, 50);
                    }
                }}
                onSelectSession={handleSelectSession}
                onEditMessage={handleEditMessage}
                onRetryMessage={handleRetryMessage}
                onDeleteMessage={handleDeleteMessage}
                onMessageRenderError={handleMessageRenderError}
                onScrollBottom={scrollToMessagesBottom}
            />

            <AIChatInput
                input={input}
                setInput={setInput}
                draftAttachments={draftAttachments}
                setDraftAttachments={setDraftAttachments}
                sending={sending}
                onSend={handleSend}
                onStop={handleStop}
                handleKeyDown={handleKeyDown}
                activeConnName={activeConnName}
                activeContext={activeContext}
                activeProvider={activeProvider}
                dynamicModels={dynamicModels}
                loadingModels={loadingModels}
                sendShortcutBinding={aiChatSendShortcutBinding}
                shortcutPlatform={activeShortcutPlatform}
                composerNotice={composerNotice}
                onComposerAction={handleComposerActionWithNoticeReset}
                onModelChange={handleModelChangeWithNoticeReset}
                onFetchModels={fetchDynamicModels}
                thinkingIntensity={thinkingIntensity}
                onThinkingIntensityChange={setThinkingIntensity}
                textareaRef={textareaRef}
                darkMode={darkMode}
                textColor={textColor}
                mutedColor={mutedColor}
                overlayTheme={overlayTheme}
                contextUsageChars={contextUsageChars}
                maxContextChars={getDynamicMaxContextChars(activeProvider?.model)}
                isV2Ui={isV2Ui}
            />

            <AIHistoryDrawer
                open={historyOpen}
                onClose={() => setHistoryOpen(false)}
                bgColor={bgColor}
                darkMode={darkMode}
                textColor={textColor}
                mutedColor={mutedColor}
                borderColor={borderColor}
                onCreateNew={handleCreateSession}
                onSelectSession={handleSelectSession}
                disabled={sending || interactionDisabled}
                sessionId={sid}
            />
        </div>
    );
};

export default AIChatPanel;
