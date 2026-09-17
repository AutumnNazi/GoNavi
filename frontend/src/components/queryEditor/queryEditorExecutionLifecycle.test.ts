import { describe, expect, it } from 'vitest';

import {
    createIdleQueryEditorExecutionLifecycle,
    isQueryEditorCancelledRpcError,
    markQueryEditorExecutionStalled,
    queryEditorExecutionStatusI18nKey,
    queryEditorExecutionTimerStatusI18nKey,
    reduceQueryEditorExecutionLifecycle,
    shouldApplyQueryExecutionProgressEvent,
    shouldRetainQueryEditorRun,
    shouldRetainQueryEditorRunAfterRpcFailure,
    resolveVisibleQueryEditorExecutionLifecycle,
} from './queryEditorExecutionLifecycle';

describe('query editor execution lifecycle', () => {
    it('reduces start, heartbeat, and done events for a DELETE', () => {
        const started = reduceQueryEditorExecutionLifecycle(
            createIdleQueryEditorExecutionLifecycle(),
            { queryId: 'query-1', status: 'running', stage: 'starting', elapsedMs: 12, cancellable: true },
            1_000,
        );
        expect(started).toMatchObject({
            queryId: 'query-1',
            status: 'running',
            backendAlive: true,
            cancellable: true,
        });

        const heartbeating = reduceQueryEditorExecutionLifecycle(
            started,
            { queryId: 'query-1', status: 'running', stage: 'executing', elapsedMs: 1500 },
            2_500,
        );
        expect(heartbeating.stage).toBe('executing');
        expect(heartbeating.lastEventAt).toBe(2_500);

        const done = reduceQueryEditorExecutionLifecycle(
            heartbeating,
            {
                queryId: 'query-1',
                status: 'done',
                stage: 'completed',
                elapsedMs: 8_000,
                hasAffectedRows: true,
                affectedRows: 100000,
            },
            9_000,
        );
        expect(done).toMatchObject({
            status: 'done',
            hasAffectedRows: true,
            affectedRows: 100000,
            backendAlive: false,
        });
        expect(shouldRetainQueryEditorRun(done)).toBe(false);
    });

    it('keeps a live DELETE after a transport failure but not after a local abort', () => {
        const running = reduceQueryEditorExecutionLifecycle(
            createIdleQueryEditorExecutionLifecycle(),
            { queryId: 'query-1', status: 'running', stage: 'executing' },
            1_000,
        );
        expect(shouldRetainQueryEditorRunAfterRpcFailure(new Error('Failed to fetch'), running)).toBe(true);
        expect(shouldRetainQueryEditorRunAfterRpcFailure({
            name: 'AbortError',
            code: 'WEB_RPC_ABORTED',
            dispatchState: 'possibly_dispatched',
            message: 'Web RPC request was aborted',
        }, running)).toBe(true);
        expect(shouldRetainQueryEditorRunAfterRpcFailure({
            name: 'AbortError',
            code: 'WEB_RPC_ABORTED',
            dispatchState: 'not_started',
            message: 'Web RPC request was aborted',
        }, running)).toBe(false);
    });

    it('marks a running query stalled after the heartbeat gap and recovers on the next event', () => {
        const running = reduceQueryEditorExecutionLifecycle(
            createIdleQueryEditorExecutionLifecycle(),
            { queryId: 'query-1', status: 'running', stage: 'executing' },
            1_000,
        );
        const stalled = markQueryEditorExecutionStalled(running, 7_000);
        expect(stalled.status).toBe('stalled');
        expect(shouldRetainQueryEditorRun(stalled)).toBe(true);
        expect(queryEditorExecutionStatusI18nKey(stalled.status)).toBe('query_editor.execution.status.stalled');

        const recovered = reduceQueryEditorExecutionLifecycle(
            stalled,
            { queryId: 'query-1', status: 'running', stage: 'executing', elapsedMs: 7000 },
            7_050,
        );
        expect(recovered.status).toBe('running');
    });

    it('ignores a late heartbeat after the DELETE has already completed', () => {
        const done = reduceQueryEditorExecutionLifecycle(
            createIdleQueryEditorExecutionLifecycle(),
            {
                queryId: 'query-1',
                status: 'done',
                stage: 'completed',
                hasAffectedRows: true,
                affectedRows: 10,
            },
            1_000,
        );
        const late = reduceQueryEditorExecutionLifecycle(
            done,
            { queryId: 'query-1', status: 'running', stage: 'executing', elapsedMs: 1100 },
            1_100,
        );
        expect(late.status).toBe('done');
        expect(late.affectedRows).toBe(10);
    });

    it('treats context canceled RPC errors as cancellation', () => {
        expect(isQueryEditorCancelledRpcError(new Error('context canceled'))).toBe(true);
        expect(isQueryEditorCancelledRpcError(new Error('connection refused'))).toBe(false);
    });

    it('shows a starting lifecycle while the editor is waiting for the first heartbeat', () => {
        const visible = resolveVisibleQueryEditorExecutionLifecycle(true, createIdleQueryEditorExecutionLifecycle());
        expect(visible?.status).toBe('starting');
        expect(visible?.backendAlive).toBe(true);
        expect(resolveVisibleQueryEditorExecutionLifecycle(false, createIdleQueryEditorExecutionLifecycle())).toBeNull();
    });

    it('does not attach another tab\'s progress to an editor that has not started a run', () => {
        expect(shouldApplyQueryExecutionProgressEvent('', 'query-1')).toBe(false);
        expect(shouldApplyQueryExecutionProgressEvent('query-1', 'query-2')).toBe(false);
        expect(shouldApplyQueryExecutionProgressEvent('query-1', 'query-1')).toBe(true);
        const leaked = {
            ...createIdleQueryEditorExecutionLifecycle(),
            queryId: 'query-other',
            status: 'running' as const,
            backendAlive: true,
        };
        expect(queryEditorExecutionTimerStatusI18nKey(false, leaked)).toBe('');
        expect(queryEditorExecutionTimerStatusI18nKey(true, leaked)).toBe('query_editor.execution.status.running');
    });
});
