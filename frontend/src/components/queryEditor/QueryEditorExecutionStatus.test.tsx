import React from 'react';
import { create } from 'react-test-renderer';
import { beforeEach, describe, expect, it } from 'vitest';

import { setCurrentLanguage } from '../../i18n';
import { QueryEditorExecutionStatus } from './QueryEditorExecutionStatus';
import { createIdleQueryEditorExecutionLifecycle } from './queryEditorExecutionLifecycle';

describe('QueryEditorExecutionStatus', () => {
    beforeEach(() => {
        setCurrentLanguage('zh-CN');
    });

    it('explains a live DELETE before affected rows exist', () => {
        const renderer = create(
            <QueryEditorExecutionStatus
                lifecycle={{
                    ...createIdleQueryEditorExecutionLifecycle(),
                    queryId: 'query-1',
                    status: 'running',
                    backendAlive: true,
                }}
            />,
        );
        const text = JSON.stringify(renderer.toJSON());
        expect(text).toContain('正在执行 SQL');
        expect(text).toContain('后端仍在执行');
        expect(text).toContain('影响行数将在语句结束后返回');
    });

    it('shows unknown outcome after a cancelled write', () => {
        const renderer = create(
            <QueryEditorExecutionStatus
                lifecycle={{
                    ...createIdleQueryEditorExecutionLifecycle(),
                    queryId: 'query-1',
                    status: 'cancelled',
                    outcomeUnknown: true,
                }}
            />,
        );
        const text = JSON.stringify(renderer.toJSON());
        expect(text).toContain('已停止');
        expect(text).toContain('数据库侧结果未知');
    });
});
