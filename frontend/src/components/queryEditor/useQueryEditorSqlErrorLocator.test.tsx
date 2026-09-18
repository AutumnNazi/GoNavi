import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useQueryEditorSqlErrorLocator } from './useQueryEditorSqlErrorLocator';

const warning = vi.fn();

vi.mock('antd', () => ({
    message: {
        warning: (...args: unknown[]) => warning(...args),
    },
}));

type QueryEditorSqlErrorLocatorHarnessProps = {
    editorRef: Parameters<typeof useQueryEditorSqlErrorLocator>[0];
    onReady: (api: ReturnType<typeof useQueryEditorSqlErrorLocator>) => void;
};

const HookHarness: React.FC<QueryEditorSqlErrorLocatorHarnessProps> = ({ editorRef, onReady }) => {
    const api = useQueryEditorSqlErrorLocator(editorRef);
    onReady(api);
    return null;
};

describe('useQueryEditorSqlErrorLocator', () => {
    beforeEach(() => {
        warning.mockReset();
    });

    it('records the executed SQL origin and jumps the editor to the reported offset', () => {
        const sql = 'SELECT (id FROM users';
        const setPosition = vi.fn();
        const editorRef = {
            current: {
                getModel: () => ({ getValue: () => sql }),
                setPosition,
                setSelection: vi.fn(),
                revealPositionInCenterIfOutsideViewport: vi.fn(),
                focus: vi.fn(),
            },
        };
        let api!: ReturnType<typeof useQueryEditorSqlErrorLocator>;
        create(
            <HookHarness
                editorRef={editorRef}
                onReady={(next) => {
                    api = next;
                }}
            />,
        );

        act(() => {
            api.recordExecutionOrigin(sql, sql, sql);
        });
        expect(api.locateExecutionError(
            'ORA-00907: missing right parenthesis\nerror occur at position: 9',
        )).toBe(true);
        expect(setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 9 });
        expect(warning).not.toHaveBeenCalled();
    });

    it('warns when the error has no locatable position', () => {
        const editorRef = { current: { setPosition: vi.fn() } };
        let api!: ReturnType<typeof useQueryEditorSqlErrorLocator>;
        create(
            <HookHarness
                editorRef={editorRef}
                onReady={(next) => {
                    api = next;
                }}
            />,
        );
        expect(api.locateExecutionError('table not found')).toBe(false);
        expect(warning).toHaveBeenCalledTimes(1);
    });
});
