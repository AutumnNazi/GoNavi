import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';

import {
  isShortcutMatch,
  resolveShortcutBinding,
  type ShortcutOptions,
  type ShortcutPlatform,
  type ShortcutPlatformBinding,
} from '../../utils/shortcuts';
import { isDocumentLevelShortcutTarget, resolveEventTargetNode } from './QueryEditorHelpers';

export interface UseQueryEditorFullscreenArgs {
  isActive: boolean;
  shortcutOptions: Partial<ShortcutOptions> | null | undefined;
  activeShortcutPlatform: ShortcutPlatform;
  editorRef: { current: { hasTextFocus?: () => boolean } | null };
  rootRef: RefObject<HTMLElement | null>;
  editorHeight: number;
  resultsPanelVisible: boolean;
}

export interface QueryEditorFullscreenState {
  active: boolean;
  toggle: () => void;
  shortcutBinding: ShortcutPlatformBinding;
  /** 全屏时结果区从渲染树摘除但数据与可见性状态不动，退出后原样恢复。 */
  resultsAreaMounted: boolean;
  stageStyle: CSSProperties;
}

/**
 * 编辑器面板级全屏：只放大查询编辑器面板内部（编辑区占满面板可视区），
 * 不改变结果区数据、isResultPanelVisible 持久化状态与每标签页分隔比例；
 * 退出后由既有的比例应用 effect 恢复进入前的分隔高度。
 */
export const useQueryEditorFullscreen = ({
  isActive,
  shortcutOptions,
  activeShortcutPlatform,
  editorRef,
  rootRef,
  editorHeight,
  resultsPanelVisible,
}: UseQueryEditorFullscreenArgs): QueryEditorFullscreenState => {
  const [active, setActive] = useState(false);
  const toggle = useCallback(() => setActive(previous => !previous), []);
  const shortcutBinding = useMemo(
    () => resolveShortcutBinding(shortcutOptions, 'toggleEditorFullscreen', activeShortcutPlatform),
    [activeShortcutPlatform, shortcutOptions],
  );

  // 最新作用域状态放 ref，避免每次渲染重挂 window 监听。
  const scopeRef = useRef({ isActive, editorRef, rootRef });
  scopeRef.current = { isActive, editorRef, rootRef };

  useEffect(() => {
    const binding = shortcutBinding;
    if (!binding.enabled || !binding.combo) {
      return;
    }

    const handleFullscreenShortcut = (event: KeyboardEvent) => {
      const scope = scopeRef.current;
      if (!scope.isActive) {
        return;
      }
      if (!isShortcutMatch(event, binding.combo)) {
        return;
      }

      const editor = scope.editorRef.current;
      const targetNode = resolveEventTargetNode(event.target);
      const editorHasFocus = !!editor?.hasTextFocus?.();
      const inQueryEditor = !!(targetNode && scope.rootRef.current?.contains(targetNode));
      if (!editorHasFocus && !inQueryEditor && !isDocumentLevelShortcutTarget(targetNode)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setActive(previous => !previous);
    };

    window.addEventListener('keydown', handleFullscreenShortcut, true);
    return () => {
      window.removeEventListener('keydown', handleFullscreenShortcut, true);
    };
  }, [shortcutBinding]);

  const resultsAreaMounted = resultsPanelVisible && !active;
  const stageStyle: CSSProperties = resultsAreaMounted
    ? { height: editorHeight, minHeight: '100px' }
    : { flex: '1 1 auto', minHeight: 0 };

  return { active, toggle, shortcutBinding, resultsAreaMounted, stageStyle };
};
