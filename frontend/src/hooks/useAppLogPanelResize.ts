import React, { useCallback, useEffect, useRef, useState } from 'react';

const LOG_PANEL_TOOLBAR_HEIGHT = 32;
const LOG_PANEL_SINGLE_ROW_HEIGHT = 39;
const LOG_PANEL_MIN_VISIBLE_ROWS = 1;
const LOG_PANEL_MIN_HEIGHT = LOG_PANEL_TOOLBAR_HEIGHT + (LOG_PANEL_SINGLE_ROW_HEIGHT * LOG_PANEL_MIN_VISIBLE_ROWS);
const LOG_PANEL_MAX_HEIGHT = 800;

type LogResizeListeners = {
  blur: () => void;
  move: (event: MouseEvent) => void;
  up: (event: MouseEvent) => void;
};

export const useAppLogPanelResize = () => {
  const [logPanelHeight, setLogPanelHeight] = useState(Math.max(200, LOG_PANEL_MIN_HEIGHT));
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  const logResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const logGhostRef = useRef<HTMLDivElement>(null);
  const logResizeListenersRef = useRef<LogResizeListeners | null>(null);
  const latestMouseYRef = useRef(0);

  const handleToggleLogPanel = useCallback(() => {
    setIsLogPanelOpen((prev) => !prev);
  }, []);

  const handleCloseLogPanel = useCallback(() => {
    setIsLogPanelOpen(false);
  }, []);

  const detachLogResizeListeners = useCallback(() => {
    const listeners = logResizeListenersRef.current;
    if (!listeners) return;
    logResizeListenersRef.current = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('mousemove', listeners.move);
      document.removeEventListener('mouseup', listeners.up);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', listeners.blur);
    }
  }, []);

  const finishLogResize = useCallback((clientY?: number, commit = true) => {
    const dragState = logResizeRef.current;
    logResizeRef.current = null;

    if (logGhostRef.current) {
      logGhostRef.current.style.display = 'none';
    }
    detachLogResizeListeners();

    if (commit && dragState) {
      const finalMouseY = Number.isFinite(clientY) ? clientY as number : latestMouseYRef.current;
      const delta = dragState.startY - finalMouseY;
      const newHeight = Math.max(
        LOG_PANEL_MIN_HEIGHT,
        Math.min(LOG_PANEL_MAX_HEIGHT, dragState.startHeight + delta),
      );
      setLogPanelHeight(newHeight);
    }
  }, [detachLogResizeListeners]);

  const handleLogResizeStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();

    finishLogResize(undefined, false);
    logResizeRef.current = { startY: e.clientY, startHeight: logPanelHeight };
    latestMouseYRef.current = e.clientY;

    if (logGhostRef.current) {
      logGhostRef.current.style.top = `${e.clientY}px`;
      logGhostRef.current.style.display = 'block';
    }

    const handleMove = (event: MouseEvent) => {
      if (!logResizeRef.current) return;
      latestMouseYRef.current = event.clientY;
      if (event.buttons === 0) {
        finishLogResize(event.clientY);
        return;
      }
      if (logGhostRef.current) {
        logGhostRef.current.style.top = `${event.clientY}px`;
      }
    };
    const handleUp = (event: MouseEvent) => finishLogResize(event.clientY);
    const handleBlur = () => finishLogResize();

    logResizeListenersRef.current = {
      blur: handleBlur,
      move: handleMove,
      up: handleUp,
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    window.addEventListener('blur', handleBlur);
  }, [finishLogResize, logPanelHeight]);

  useEffect(() => () => {
    finishLogResize(undefined, false);
  }, [finishLogResize]);

  return {
    handleCloseLogPanel,
    handleLogResizeStart,
    handleToggleLogPanel,
    isLogPanelOpen,
    logGhostRef,
    logPanelHeight,
  };
};
