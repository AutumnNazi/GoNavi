import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ExpandOutlined } from '@ant-design/icons';
import { t } from '../i18n';
import { DETACH_TAB_DRAG_Y_THRESHOLD } from '../utils/detachedWindow';

export type DetachDragPreviewState = {
  title: string;
  clientX: number;
  clientY: number;
  willDetach: boolean;
  progress: number;
};

/** 离开标签栏这么远才显示预览：左右拖动排序时的手抖不算拖出意图。 */
export const DETACH_PREVIEW_REVEAL_DISTANCE = 16;

export const buildDetachDragPreviewState = (params: {
  title: string;
  clientX: number;
  clientY: number;
  deltaY: number;
}): DetachDragPreviewState | null => {
  const distance = Math.abs(params.deltaY);
  if (!Number.isFinite(distance) || distance < DETACH_PREVIEW_REVEAL_DISTANCE) return null;
  const progress = Math.max(0, Math.min(1, distance / DETACH_TAB_DRAG_Y_THRESHOLD));
  return {
    title: params.title,
    clientX: params.clientX,
    clientY: params.clientY,
    willDetach: distance >= DETACH_TAB_DRAG_Y_THRESHOLD,
    progress,
  };
};

type DetachDragPreviewProps = {
  preview: DetachDragPreviewState | null;
  darkMode?: boolean;
};

/**
 * 拖出独立窗口时的跟手预览（工作区 Tab / 结果 Tab 共用）。
 */
export const DetachDragPreview: React.FC<DetachDragPreviewProps> = ({
  preview,
  darkMode = false,
}) => {
  const portal = useMemo(() => {
    if (!preview || typeof document === 'undefined') {
      return null;
    }
    const previewWidth = 200 + preview.progress * 300;
    const previewHeight = 52 + preview.progress * 200;
    const left = Math.max(12, preview.clientX - previewWidth * 0.28);
    const top = Math.max(12, preview.clientY - 22);
    const hint = preview.willDetach ? t('detach_preview.release_to_open') : t('detach_preview.keep_dragging');
    return createPortal(
      <>
        <style>{`
          .gn-detach-preview {
            position: fixed;
            z-index: 1400;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border-radius: 12px;
            border: 1px solid rgba(22, 119, 255, 0.28);
            background: rgba(255, 255, 255, 0.96);
            box-shadow: 0 16px 40px rgba(15, 23, 42, 0.22);
            pointer-events: none;
            transition: width 80ms ease-out, height 80ms ease-out, transform 80ms ease-out, opacity 80ms ease-out, border-color 120ms ease, box-shadow 120ms ease;
          }
          .gn-detach-preview.is-dark {
            border-color: rgba(255, 214, 102, 0.4);
            background: rgba(28, 30, 36, 0.96);
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
            color: rgba(255, 255, 255, 0.92);
          }
          .gn-detach-preview.is-ready {
            border-color: rgba(22, 119, 255, 0.55);
            box-shadow: 0 0 0 1px rgba(22, 119, 255, 0.2), 0 20px 48px rgba(15, 23, 42, 0.28);
          }
          .gn-detach-preview.is-dark.is-ready {
            border-color: rgba(255, 214, 102, 0.7);
            box-shadow: 0 0 0 1px rgba(255, 214, 102, 0.25), 0 20px 48px rgba(0, 0, 0, 0.55);
          }
          .gn-detach-preview-chrome {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 36px;
            padding: 6px 10px;
            border-bottom: 1px solid rgba(0, 0, 0, 0.06);
            background: rgba(0, 0, 0, 0.03);
            font-size: 12px;
          }
          .gn-detach-preview.is-dark .gn-detach-preview-chrome {
            border-bottom-color: rgba(255, 255, 255, 0.08);
            background: rgba(255, 255, 255, 0.04);
          }
          .gn-detach-preview-chrome strong {
            min-width: 0;
            flex: 1 1 auto;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: 700;
          }
          .gn-detach-preview-body {
            flex: 1 1 auto;
            min-height: 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px;
            position: relative;
          }
          .gn-detach-preview-body > span {
            font-size: 12px;
            font-weight: 600;
            color: rgba(0, 0, 0, 0.55);
          }
          .gn-detach-preview.is-dark .gn-detach-preview-body > span {
            color: rgba(255, 255, 255, 0.55);
          }
          .gn-detach-preview.is-ready .gn-detach-preview-body > span {
            color: rgba(22, 119, 255, 0.9);
          }
          .gn-detach-preview.is-dark.is-ready .gn-detach-preview-body > span {
            color: rgba(255, 214, 102, 0.95);
          }
          .gn-detach-preview-progress {
            height: 4px;
            border-radius: 999px;
            background: rgba(0, 0, 0, 0.06);
            overflow: hidden;
          }
          .gn-detach-preview.is-dark .gn-detach-preview-progress {
            background: rgba(255, 255, 255, 0.08);
          }
          .gn-detach-preview-progress > i {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, rgba(22, 119, 255, 0.75), rgba(64, 150, 255, 0.95));
            transition: width 80ms linear;
          }
          .gn-detach-preview.is-dark .gn-detach-preview-progress > i {
            background: linear-gradient(90deg, rgba(255, 214, 102, 0.7), rgba(255, 230, 150, 0.95));
          }
          .gn-detach-preview-grid {
            flex: 1 1 auto;
            min-height: 24px;
            border-radius: 8px;
            border: 1px dashed rgba(0, 0, 0, 0.1);
            background:
              linear-gradient(rgba(22, 119, 255, 0.04) 1px, transparent 1px) 0 0 / 100% 18px,
              linear-gradient(90deg, rgba(22, 119, 255, 0.04) 1px, transparent 1px) 0 0 / 48px 100%;
          }
          .gn-detach-preview.is-dark .gn-detach-preview-grid {
            border-color: rgba(255, 255, 255, 0.1);
            background:
              linear-gradient(rgba(255, 214, 102, 0.06) 1px, transparent 1px) 0 0 / 100% 18px,
              linear-gradient(90deg, rgba(255, 214, 102, 0.06) 1px, transparent 1px) 0 0 / 48px 100%;
          }
        `}</style>
        <div
          className={`gn-detach-preview${preview.willDetach ? ' is-ready' : ''}${darkMode ? ' is-dark' : ''}`}
          style={{
            left,
            top,
            width: previewWidth,
            height: previewHeight,
            opacity: 0.9 + preview.progress * 0.1,
            transform: `scale(${0.9 + preview.progress * 0.12})`,
          }}
          aria-hidden
        >
          <div className="gn-detach-preview-chrome">
            <ExpandOutlined />
            <strong>{preview.title}</strong>
          </div>
          <div className="gn-detach-preview-body">
            <span>{hint}</span>
            <div className="gn-detach-preview-progress">
              <i style={{ width: `${Math.max(8, preview.progress * 100)}%` }} />
            </div>
            <div className="gn-detach-preview-grid" />
          </div>
        </div>
      </>,
      document.body,
    );
  }, [darkMode, preview]);

  return portal;
};

export default DetachDragPreview;
