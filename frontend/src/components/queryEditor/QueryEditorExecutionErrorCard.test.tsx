import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setCurrentLanguage } from '../../i18n';
import { QueryEditorExecutionErrorCard } from './QueryEditorExecutionErrorCard';

vi.mock('antd', () => ({
    Button: ({ children, onClick, icon }: { children?: React.ReactNode; onClick?: () => void; icon?: React.ReactNode }) => (
        <button type="button" onClick={onClick}>{icon}{children}</button>
    ),
}));

vi.mock('@ant-design/icons', () => {
    const Icon = () => <span />;
    return {
        AimOutlined: Icon,
        CloseOutlined: Icon,
        RobotOutlined: Icon,
    };
});

const textContent = (node: unknown): string => {
    if (node == null) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textContent).join('');
    const element = node as { children?: unknown };
    return textContent(element.children);
};

describe('QueryEditorExecutionErrorCard', () => {
    beforeEach(() => {
        setCurrentLanguage('zh-CN');
    });

    it('lets the reported Oracle position jump to the editor', () => {
        const onLocate = vi.fn();
        const onDiagnose = vi.fn();
        const renderer = create(
            <QueryEditorExecutionErrorCard
                darkMode={false}
                error={'第 1 条语句执行失败: ORA-00907: missing right parenthesis\nerror occur at position: 2868'}
                onDiagnose={onDiagnose}
                onLocate={onLocate}
            />,
        );
        const text = textContent(renderer.toJSON());
        expect(text).toContain('执行失败');
        expect(text).toContain('定位');
        expect(text).toContain('一键 AI 诊断');
        expect(text).toContain('2868');

        const locateButtons = renderer.root.findAll((node) => (
            node.type === 'button' && textContent(node).includes('2868')
        ));
        expect(locateButtons.length).toBeGreaterThan(0);
        act(() => {
            locateButtons[0].props.onClick();
        });
        expect(onLocate).toHaveBeenCalledTimes(1);
    });

    it('shows locate for KingBase syntax errors that only report the nearby token', () => {
        const onLocate = vi.fn();
        const renderer = create(
            <QueryEditorExecutionErrorCard
                darkMode={false}
                error={'第 1 条语句执行失败: kb: syntax error at or near "("'}
                onDiagnose={vi.fn()}
                onLocate={onLocate}
            />,
        );
        const text = textContent(renderer.toJSON());
        expect(text).toContain('定位');
        expect(text).toContain('at or near');

        const locateButton = renderer.root.findAll((node) => (
            node.type === 'button' && textContent(node).includes('定位')
        ))[0];
        act(() => {
            locateButton.props.onClick();
        });
        expect(onLocate).toHaveBeenCalledTimes(1);
    });

    it('hides locate when the error has no position', () => {
        const renderer = create(
            <QueryEditorExecutionErrorCard
                darkMode
                error={"Table 'demo.t' doesn't exist"}
                onDiagnose={vi.fn()}
                onLocate={vi.fn()}
            />,
        );
        expect(textContent(renderer.toJSON())).not.toContain('定位');
    });
});
