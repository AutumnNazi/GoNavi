import React from 'react';
import { t } from '../../i18n';

/** 列表宽度的持久化键与拖拽约束：窄下限保住筛选栏，右侧保留详情最小空间。 */
export const SESSION_ASSETS_LIST_WIDTH_KEY = 'gonavi.sessionAssets.listWidth';
export const SESSION_ASSETS_LIST_MIN_WIDTH = 240;
export const SESSION_ASSETS_LIST_RESERVE = 420;
const SESSION_ASSETS_LIST_MAX_STORED_WIDTH = 1600;

export const loadSessionAssetsListWidth = (): number | undefined => {
  try {
    const raw = window.localStorage.getItem(SESSION_ASSETS_LIST_WIDTH_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (
      Number.isFinite(parsed) &&
      parsed >= SESSION_ASSETS_LIST_MIN_WIDTH &&
      parsed <= SESSION_ASSETS_LIST_MAX_STORED_WIDTH
    ) {
      return parsed;
    }
  } catch {
    // 存储不可用时回退 CSS 默认宽度。
  }
  return undefined;
};

export const saveSessionAssetsListWidth = (width: number): void => {
  try {
    window.localStorage.setItem(SESSION_ASSETS_LIST_WIDTH_KEY, String(width));
  } catch {
    // 持久化失败不阻断本次会话内的拖拽结果。
  }
};

/**
 * 列表与详情之间的拖拽分割条：拖动期间直接改 DOM flexBasis 保持跟手，
 * 松手后提交宽度（状态 + localStorage）。窄屏（≤900px）由 CSS 隐藏。
 */
export const SessionAssetsListResizeDivider: React.FC<{
  onCommit: (width: number) => void;
}> = ({ onCommit }) => {
  const handleMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget.previousElementSibling as HTMLElement | null;
      if (!target) return;
      const container = target.parentElement;
      const containerWidth = container?.offsetWidth || window.innerWidth;
      const maxWidth = Math.max(
        SESSION_ASSETS_LIST_MIN_WIDTH + 80,
        containerWidth - SESSION_ASSETS_LIST_RESERVE,
      );
      const startX = event.clientX;
      const startWidth = target.offsetWidth;

      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;top:0;left:0;right:0;bottom:0;cursor:col-resize;z-index:9999;';
      document.body.appendChild(overlay);

      let currentWidth = startWidth;
      const cleanup = (commit: boolean) => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', finish);
        window.removeEventListener('blur', abort);
        if (overlay.isConnected) overlay.remove();
        if (commit) onCommit(currentWidth);
      };
      const abort = () => cleanup(false);
      const finish = () => cleanup(true);
      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (moveEvent.buttons === 0) {
          finish();
          return;
        }
        moveEvent.preventDefault();
        currentWidth = Math.min(
          maxWidth,
          Math.max(SESSION_ASSETS_LIST_MIN_WIDTH, startWidth + moveEvent.clientX - startX),
        );
        target.style.flexBasis = `${currentWidth}px`;
        target.style.width = `${currentWidth}px`;
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', finish);
      window.addEventListener('blur', abort);
    },
    [onCommit],
  );

  return (
    <div
      className="session-assets-list-resize"
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
      title={t('session_assets.workbench.resize_list')}
    />
  );
};
