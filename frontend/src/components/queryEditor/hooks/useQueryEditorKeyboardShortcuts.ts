import {
    useActivationGatedEffect,
    useQueryEditorActivationRef,
} from './useActivationGatedEffect';
import { isShortcutMatch, isEditableElement } from '../../../utils/shortcuts';
import { resolveEventTargetNode, isDocumentLevelShortcutTarget } from '../QueryEditorHelpers';
import { useQueryEditorSqlLogBridge } from '../useQueryEditorSqlLogBridge';
import { QUERY_EDITOR_SQL_LOG_TAB_KEY } from '../../QueryEditorResultsPanel';
import type { QueryEditorShortcutsAndSnippetsApi } from './useQueryEditorShortcutsAndSnippets';
import type { QueryEditorCoreStateApi } from './useQueryEditorCoreState';
import type { QueryEditorExecutionStatusApi } from './useQueryEditorExecutionStatus';
import type { QueryEditorSaveActionsApi } from './useQueryEditorSaveActions';
import type { QueryEditorQueryContextApi } from './useQueryEditorQueryContext';
import type { QueryEditorFormattingApi } from './useQueryEditorFormatting';
import type { QueryEditorAiCompletionTriggersApi } from './useQueryEditorAiCompletionTriggers';
import type { QueryEditorConnectionContextApi } from './useQueryEditorConnectionContext';
import type { QueryEditorProps } from '../../QueryEditor';

export interface UseQueryEditorKeyboardShortcutsInput {
    isActive: Exclude<QueryEditorProps['isActive'], undefined>;
    findInEditorShortcutCombo: QueryEditorShortcutsAndSnippetsApi['findInEditorShortcutCombo'];
    editorRef: QueryEditorCoreStateApi['editorRef'];
    editorPaneRef: QueryEditorCoreStateApi['editorPaneRef'];
    queryEditorRootRef: QueryEditorCoreStateApi['queryEditorRootRef'];
    handleOpenEditorFind: QueryEditorExecutionStatusApi['handleOpenEditorFind'];
    saveQueryShortcutBinding: QueryEditorShortcutsAndSnippetsApi['saveQueryShortcutBinding'];
    handleQuickSave: QueryEditorSaveActionsApi['handleQuickSave'];
    tab: QueryEditorProps['tab'];
    saveQueryAsShortcutBinding: QueryEditorShortcutsAndSnippetsApi['saveQueryAsShortcutBinding'];
    currentSavedQuery: QueryEditorQueryContextApi['currentSavedQuery'];
    handleSaveQueryAs: QueryEditorSaveActionsApi['handleSaveQueryAs'];
    formatSqlShortcutBinding: QueryEditorShortcutsAndSnippetsApi['formatSqlShortcutBinding'];
    handleFormatRef: QueryEditorFormattingApi['handleFormatRef'];
    triggerSqlAiCompletionAltGestureAtRef: QueryEditorCoreStateApi['triggerSqlAiCompletionAltGestureAtRef'];
    triggerSqlAiCompletionAltPressedRef: QueryEditorCoreStateApi['triggerSqlAiCompletionAltPressedRef'];
    triggerSqlAiCompletionFallbackRef: QueryEditorCoreStateApi['triggerSqlAiCompletionFallbackRef'];
    triggerSqlAiCompletionShortcutBinding: QueryEditorShortcutsAndSnippetsApi['triggerSqlAiCompletionShortcutBinding'];
    isTriggerSqlAiCompletionShortcutEvent: QueryEditorAiCompletionTriggersApi['isTriggerSqlAiCompletionShortcutEvent'];
    isPossibleTriggerSqlAiCompletionFallbackEvent: QueryEditorAiCompletionTriggersApi['isPossibleTriggerSqlAiCompletionFallbackEvent'];
    triggerAiInlineCompletionRef: QueryEditorCoreStateApi['triggerAiInlineCompletionRef'];
    toggleQueryResultsPanelShortcutBinding: QueryEditorShortcutsAndSnippetsApi['toggleQueryResultsPanelShortcutBinding'];
    toggleResultPanelVisibility: QueryEditorExecutionStatusApi['toggleResultPanelVisibility'];
    isResultPanelVisible: QueryEditorConnectionContextApi['isResultPanelVisible'];
    activeResultKey: QueryEditorCoreStateApi['activeResultKey'];
    handleShowSqlExecutionLog: QueryEditorExecutionStatusApi['handleShowSqlExecutionLog'];
}

export const useQueryEditorKeyboardShortcuts = ({
    isActive, findInEditorShortcutCombo, editorRef, editorPaneRef, queryEditorRootRef,
    handleOpenEditorFind, saveQueryShortcutBinding, handleQuickSave, tab,
    saveQueryAsShortcutBinding, currentSavedQuery, handleSaveQueryAs, formatSqlShortcutBinding,
    handleFormatRef, triggerSqlAiCompletionAltGestureAtRef, triggerSqlAiCompletionAltPressedRef,
    triggerSqlAiCompletionFallbackRef, triggerSqlAiCompletionShortcutBinding,
    isTriggerSqlAiCompletionShortcutEvent, isPossibleTriggerSqlAiCompletionFallbackEvent,
    triggerAiInlineCompletionRef, toggleQueryResultsPanelShortcutBinding,
    toggleResultPanelVisibility, isResultPanelVisible, activeResultKey, handleShowSqlExecutionLog,
}: UseQueryEditorKeyboardShortcutsInput) => {
    // 非激活 tab 副作用瘦身：keydown 监听随激活挂/拆（改造前是常驻 + 回调内早退，
    // 多 tab 常开时按键捕获链会按 tab 数线性放大）。
    const isActiveRef = useQueryEditorActivationRef(isActive);
    useActivationGatedEffect(isActive, () => {
        const handleFindShortcut = (event: KeyboardEvent) => {
            if (!isActiveRef.current) {
                return;
            }
            if (!isShortcutMatch(event, findInEditorShortcutCombo)) {
                return;
            }

            const editor = editorRef.current;
            const targetNode = resolveEventTargetNode(event.target);
            const targetElement = targetNode
                && typeof (targetNode as Element).closest === 'function'
                ? targetNode as Element
                : null;
            const activeElement = document.activeElement;
            const dataGridHasFocus = !!(
                activeElement
                && typeof activeElement.closest === 'function'
                && activeElement.closest('.data-grid-root')
            );
            if (targetElement?.closest('.data-grid-root') || dataGridHasFocus) {
                return;
            }
            const editorHasFocus = !!editor?.hasTextFocus?.();
            const inEditorPane = !!(targetNode && editorPaneRef.current?.contains(targetNode));
            const inQueryEditor = !!(targetNode && queryEditorRootRef.current?.contains(targetNode));
            if (isEditableElement(event.target) && !inEditorPane) {
                return;
            }
            if (!editorHasFocus && !inEditorPane && !inQueryEditor && !isDocumentLevelShortcutTarget(targetNode)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            handleOpenEditorFind();
        };

        window.addEventListener('keydown', handleFindShortcut, true);
        return () => {
            window.removeEventListener('keydown', handleFindShortcut, true);
        };
    }, [findInEditorShortcutCombo, handleOpenEditorFind]);

    useActivationGatedEffect(isActive, () => {
        const binding = saveQueryShortcutBinding;
        if (!binding?.enabled || !binding.combo) {
            return;
        }

        const handleSaveShortcut = (event: KeyboardEvent) => {
            if (!isActiveRef.current) {
                return;
            }
            if (!isShortcutMatch(event, binding.combo)) {
                return;
            }

            const editor = editorRef.current;
            const targetNode = resolveEventTargetNode(event.target);
            const editorHasFocus = !!editor?.hasTextFocus?.();
            const inQueryEditor = !!(targetNode && queryEditorRootRef.current?.contains(targetNode));
            if (!editorHasFocus && !inQueryEditor && !isDocumentLevelShortcutTarget(targetNode)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void handleQuickSave();
        };

        window.addEventListener('keydown', handleSaveShortcut, true);
        return () => {
            window.removeEventListener('keydown', handleSaveShortcut, true);
        };
    }, [saveQueryShortcutBinding, handleQuickSave]);

    useActivationGatedEffect(isActive, () => {
        const binding = saveQueryAsShortcutBinding;
        if (!binding?.enabled || !binding.combo) {
            return;
        }

        const handleSaveAsShortcut = (event: KeyboardEvent) => {
            if (!isActiveRef.current || !currentSavedQuery || tab.filePath) {
                return;
            }
            if (!isShortcutMatch(event, binding.combo)) {
                return;
            }

            const editor = editorRef.current;
            const targetNode = resolveEventTargetNode(event.target);
            const editorHasFocus = !!editor?.hasTextFocus?.();
            const inQueryEditor = !!(targetNode && queryEditorRootRef.current?.contains(targetNode));
            if (!editorHasFocus && !inQueryEditor && !isDocumentLevelShortcutTarget(targetNode)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            handleSaveQueryAs();
        };

        window.addEventListener('keydown', handleSaveAsShortcut, true);
        return () => {
            window.removeEventListener('keydown', handleSaveAsShortcut, true);
        };
    }, [currentSavedQuery, handleSaveQueryAs, saveQueryAsShortcutBinding, tab.filePath]);

    useActivationGatedEffect(isActive, () => {
        const binding = formatSqlShortcutBinding;
        if (!binding?.enabled || !binding.combo) {
            return;
        }

        const handleFormatShortcut = (event: KeyboardEvent) => {
            if (!isActiveRef.current) {
                return;
            }
            if (!isShortcutMatch(event, binding.combo)) {
                return;
            }

            const editor = editorRef.current;
            const targetNode = resolveEventTargetNode(event.target);
            const editorHasFocus = !!editor?.hasTextFocus?.();
            const inQueryEditor = !!(targetNode && queryEditorRootRef.current?.contains(targetNode));
            if (!editorHasFocus && !inQueryEditor && !isDocumentLevelShortcutTarget(targetNode)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            handleFormatRef.current();
        };

        window.addEventListener('keydown', handleFormatShortcut, true);
        return () => {
            window.removeEventListener('keydown', handleFormatShortcut, true);
        };
    }, [formatSqlShortcutBinding]);

    // Alt 手势状态是「失活即无意义」的暂存态：随激活挂/拆，并在拆掉时清一次，
    // 避免失活期间窗口 blur 收不到导致 alt 按压态残留到下次激活。
    useActivationGatedEffect(isActive, () => {
        const updateAltState = (event: KeyboardEvent) => {
            const key = String(event.key || '').trim().toLowerCase();
            const code = String(event.code || '').trim().toLowerCase();
            const isAltKey = key === 'alt'
                || code === 'altleft'
                || code === 'altright';
            if (isAltKey) {
                if (event.type === 'keydown') {
                    triggerSqlAiCompletionAltGestureAtRef.current = Date.now();
                }
                triggerSqlAiCompletionAltPressedRef.current = event.type !== 'keyup';
            } else if (event.type === 'keyup' && !event.altKey) {
                triggerSqlAiCompletionAltPressedRef.current = false;
            }
        };
        const clearAltState = () => {
            triggerSqlAiCompletionAltPressedRef.current = false;
            triggerSqlAiCompletionAltGestureAtRef.current = 0;
            triggerSqlAiCompletionFallbackRef.current = null;
        };

        window.addEventListener('keydown', updateAltState, true);
        window.addEventListener('keyup', updateAltState, true);
        window.addEventListener('blur', clearAltState);
        return () => {
            window.removeEventListener('keydown', updateAltState, true);
            window.removeEventListener('keyup', updateAltState, true);
            window.removeEventListener('blur', clearAltState);
            clearAltState();
        };
    }, [triggerSqlAiCompletionAltGestureAtRef, triggerSqlAiCompletionAltPressedRef, triggerSqlAiCompletionFallbackRef]);

    useActivationGatedEffect(isActive, () => {
        const binding = triggerSqlAiCompletionShortcutBinding;
        if (!binding?.enabled || !binding.combo) {
            return;
        }

        const handleTriggerSqlAiCompletionShortcut = (event: KeyboardEvent) => {
            if (!isActiveRef.current) {
                return;
            }
            const editor = editorRef.current;
            const targetNode = resolveEventTargetNode(event.target);
            const editorHasFocus = !!editor?.hasTextFocus?.();
            const inQueryEditor = !!(targetNode && queryEditorRootRef.current?.contains(targetNode));
            if (!editorHasFocus && !inQueryEditor && !isDocumentLevelShortcutTarget(targetNode)) {
                return;
            }
            if (!isTriggerSqlAiCompletionShortcutEvent(event)) {
                if (isPossibleTriggerSqlAiCompletionFallbackEvent(event)) {
                    triggerSqlAiCompletionFallbackRef.current = { observedAt: Date.now() };
                }
                return;
            }

            triggerSqlAiCompletionFallbackRef.current = null;
            event.preventDefault();
            event.stopPropagation();
            triggerAiInlineCompletionRef.current?.();
        };

        window.addEventListener('keydown', handleTriggerSqlAiCompletionShortcut, true);
        return () => {
            window.removeEventListener('keydown', handleTriggerSqlAiCompletionShortcut, true);
        };
    }, [isPossibleTriggerSqlAiCompletionFallbackEvent, isTriggerSqlAiCompletionShortcutEvent, triggerSqlAiCompletionShortcutBinding]);

    useActivationGatedEffect(isActive, () => {
        const binding = toggleQueryResultsPanelShortcutBinding;
        if (!binding?.enabled || !binding.combo) {
            return;
        }

        const handleToggleResultsShortcut = (event: KeyboardEvent) => {
            if (!isActiveRef.current) {
                return;
            }
            if (!isShortcutMatch(event, binding.combo)) {
                return;
            }

            const editor = editorRef.current;
            const targetNode = resolveEventTargetNode(event.target);
            const editorHasFocus = !!editor?.hasTextFocus?.();
            const inQueryEditor = !!(targetNode && queryEditorRootRef.current?.contains(targetNode));
            if (!editorHasFocus && !inQueryEditor && !isDocumentLevelShortcutTarget(targetNode)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            toggleResultPanelVisibility();
        };

        window.addEventListener('keydown', handleToggleResultsShortcut, true);
        return () => {
            window.removeEventListener('keydown', handleToggleResultsShortcut, true);
        };
    }, [toggleQueryResultsPanelShortcutBinding, toggleResultPanelVisibility]);

    useActivationGatedEffect(isActive, () => {
        const handleSaveActiveQuery = () => {
            if (!isActiveRef.current) {
                return;
            }
            void handleQuickSave();
        };

        window.addEventListener('gonavi:save-active-query', handleSaveActiveQuery as EventListener);
        return () => {
            window.removeEventListener('gonavi:save-active-query', handleSaveActiveQuery as EventListener);
        };
    }, [handleQuickSave]);

    useActivationGatedEffect(isActive, () => {
        const handleSaveActiveQueryAs = () => {
            if (!isActiveRef.current || !currentSavedQuery || tab.filePath) {
                return;
            }
            handleSaveQueryAs();
        };

        window.addEventListener('gonavi:save-active-query-as', handleSaveActiveQueryAs as EventListener);
        return () => {
            window.removeEventListener('gonavi:save-active-query-as', handleSaveActiveQueryAs as EventListener);
        };
    }, [currentSavedQuery, handleSaveQueryAs, tab.filePath]);

    useQueryEditorSqlLogBridge({
        isActive,
        isOpen: isResultPanelVisible && activeResultKey === QUERY_EDITOR_SQL_LOG_TAB_KEY,
        onShow: handleShowSqlExecutionLog,
    });
};

export type QueryEditorKeyboardShortcutsApi = ReturnType<typeof useQueryEditorKeyboardShortcuts>;
