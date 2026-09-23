import { useEffect, useRef, useState } from 'react';

const QUERY_EXECUTION_TIMER_INTERVAL_MS = 100;

export const formatQueryExecutionElapsed = (elapsedMs: number): string => {
  const totalTenths = Math.floor(Math.max(0, Number(elapsedMs) || 0) / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const secondsText = String(seconds).padStart(2, "0");
  const minutesText = String(minutes).padStart(2, "0");

  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${minutesText}:${secondsText}.${tenths}`
    : `${minutesText}:${secondsText}.${tenths}`;
};

export const resolveReportedQueryDurationMs = (
  result: { durationMs?: unknown } | null | undefined,
  fallbackMs: number,
): number => {
  const reported = result?.durationMs;
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    return Math.round(reported);
  }
  return Math.max(0, Math.round(Number(fallbackMs) || 0));
};

export const resolveQueryExecutionSpeedIcon = (elapsedMs: number): "⚡" | "🐇" | "🐢" => {
  const normalizedElapsedMs = Math.max(0, Number(elapsedMs) || 0);
  if (normalizedElapsedMs < 1_000) return "⚡";
  if (normalizedElapsedMs < 5_000) return "🐇";
  return "🐢";
};

export const useQueryExecutionElapsed = (
  timingActive: boolean,
  executionRunToken = 0,
  completedElapsedMs: number | null = null,
): number => {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const lastTokenRef = useRef(executionRunToken);

  useEffect(() => {
    const tokenChanged = lastTokenRef.current !== executionRunToken;
    lastTokenRef.current = executionRunToken;

    if (tokenChanged && !timingActive) {
      startedAtRef.current = null;
      setElapsedMs(0);
      return;
    }

    if (!timingActive) {
      const startedAt = startedAtRef.current;
      startedAtRef.current = null;
      if (typeof completedElapsedMs === "number" && Number.isFinite(completedElapsedMs) && completedElapsedMs >= 0) {
        setElapsedMs(Math.round(completedElapsedMs));
        return;
      }
      if (startedAt !== null) {
        setElapsedMs(Date.now() - startedAt);
      }
      return;
    }

    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    setElapsedMs(0);
    const updateElapsed = () => setElapsedMs(Date.now() - startedAt);
    updateElapsed();
    const timer = globalThis.setInterval(updateElapsed, QUERY_EXECUTION_TIMER_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [completedElapsedMs, executionRunToken, timingActive]);

  return elapsedMs;
};
