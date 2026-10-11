/** @vitest-environment jsdom */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    isQueryEditorTabActive,
    publishQueryEditorTabActivation,
    subscribeQueryEditorTabActivation,
    useActivationGatedEffect,
    useQueryEditorTabActivationPublisher,
} from './useActivationGatedEffect';

interface Timeline {
    events: string[];
    mount: number;
}

interface ProbeProps {
    isActive: boolean;
    timeline: Timeline;
    deps: unknown[];
    onWindowKeydown?: () => void;
}

// 用 createElement 而非 JSX：验收命令指定的文件名是 .test.ts，tsc/vite 不会按 JSX 解析该后缀。
const Probe = ({ isActive, timeline, deps, onWindowKeydown }: ProbeProps) => {
    useActivationGatedEffect(isActive, () => {
        timeline.events.push('run');
        const keydown = () => onWindowKeydown?.();
        window.addEventListener('keydown', keydown);
        return () => {
            timeline.events.push('cleanup');
            window.removeEventListener('keydown', keydown);
        };
    }, deps);
    return createElement('span', { 'data-active': isActive ? '1' : '0' });
};

describe('useActivationGatedEffect', () => {
    let container: HTMLDivElement;
    let root: Root;
    let timeline: Timeline;

    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        timeline = { events: [], mount: 1 };
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('激活时执行 effect', async () => {
        await act(async () => {
            root.render(createElement(Probe, { isActive: true, timeline, deps: [] }));
        });
        expect(timeline.events).toEqual(['run']);
    });

    it('失活时不执行 effect，翻转回来只执行一次', async () => {
        await act(async () => {
            root.render(createElement(Probe, { isActive: false, timeline, deps: [] }));
        });
        expect(timeline.events).toEqual([]);

        await act(async () => {
            root.render(createElement(Probe, { isActive: true, timeline, deps: [] }));
        });
        expect(timeline.events).toEqual(['run']);
    });

    it('翻转时先 cleanup 再执行新 effect', async () => {
        await act(async () => {
            root.render(createElement(Probe, { isActive: true, timeline, deps: [] }));
        });
        await act(async () => {
            root.render(createElement(Probe, { isActive: false, timeline, deps: [] }));
        });
        await act(async () => {
            root.render(createElement(Probe, { isActive: true, timeline, deps: [] }));
        });
        expect(timeline.events).toEqual(['run', 'cleanup', 'run']);
    });

    it('卸载时 cleanup 且摘除 listener', async () => {
        let keydownCount = 0;
        await act(async () => {
            root.render(createElement(Probe, {
                isActive: true,
                timeline,
                deps: [],
                onWindowKeydown: () => { keydownCount += 1; },
            }));
        });
        expect(timeline.events).toEqual(['run']);

        await act(async () => root.unmount());
        expect(timeline.events).toEqual(['run', 'cleanup']);

        // 监听真的摘掉了：卸载后按键不再触达回调
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        });
        expect(keydownCount).toBe(0);
        // 重新挂一个 root 供 afterEach 卸载
        root = createRoot(container);
    });

    it('deps 变化时也先 cleanup 再执行', async () => {
        await act(async () => {
            root.render(createElement(Probe, { isActive: true, timeline, deps: ['a'] }));
        });
        await act(async () => {
            root.render(createElement(Probe, { isActive: true, timeline, deps: ['b'] }));
        });
        expect(timeline.events).toEqual(['run', 'cleanup', 'run']);
    });

    it('失活期间不挂监听（不依赖回调内早退）', async () => {
        const listener = vi.fn();
        await act(async () => {
            root.render(createElement(Probe, { isActive: false, timeline, deps: [], onWindowKeydown: listener }));
        });
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        });
        expect(listener).not.toHaveBeenCalled();
        expect(timeline.events).toEqual([]);
    });
});

describe('useActivationGatedEffect effect 引用稳定性', () => {
    it('effect 内联函数每次渲染都换引用，但不应因此重跑', async () => {
        const localContainer = document.createElement('div');
        document.body.appendChild(localContainer);
        const localRoot = createRoot(localContainer);
        const runs: number[] = [];
        let renderCount = 0;
        const InlineProbe = ({ tick }: { tick: number }) => {
            renderCount += 1;
            useActivationGatedEffect(true, () => {
                runs.push(tick);
                return undefined;
            }, []);
            return createElement('span', null, String(tick));
        };
        await act(async () => {
            localRoot.render(createElement(InlineProbe, { tick: 1 }));
        });
        await act(async () => {
            localRoot.render(createElement(InlineProbe, { tick: 2 }));
        });
        expect(renderCount).toBeGreaterThan(1);
        expect(runs).toEqual([1]);
        await act(async () => localRoot.unmount());
        localContainer.remove();
    });
});

describe('query editor tab activation channel', () => {
    it('未登记视为激活', () => {
        expect(isQueryEditorTabActive('tab-unknown')).toBe(true);
    });

    it('发布失活后变为非激活，重新发布可翻转回来', () => {
        const token = Symbol('token');
        publishQueryEditorTabActivation('tab-a', token, false);
        expect(isQueryEditorTabActive('tab-a')).toBe(false);
        publishQueryEditorTabActivation('tab-a', token, true);
        expect(isQueryEditorTabActive('tab-a')).toBe(true);
    });

    it('多实例任一激活即视为激活', () => {
        const first = Symbol('first');
        const second = Symbol('second');
        publishQueryEditorTabActivation('tab-b', first, false);
        publishQueryEditorTabActivation('tab-b', second, false);
        expect(isQueryEditorTabActive('tab-b')).toBe(false);
        publishQueryEditorTabActivation('tab-b', second, true);
        expect(isQueryEditorTabActive('tab-b')).toBe(true);
    });

    it('只在聚合结果翻转时通知订阅方', () => {
        const token = Symbol('token');
        const listener = vi.fn();
        const unsubscribe = subscribeQueryEditorTabActivation('tab-c', listener);
        publishQueryEditorTabActivation('tab-c', token, false);
        expect(listener).toHaveBeenCalledTimes(1);
        // 重复发布同一失活状态不再通知
        publishQueryEditorTabActivation('tab-c', token, false);
        expect(listener).toHaveBeenCalledTimes(1);
        publishQueryEditorTabActivation('tab-c', token, true);
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
        publishQueryEditorTabActivation('tab-c', token, false);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('发布 hook 卸载时回收 token，不误伤同 tab 的另一实例', async () => {
        const localContainer = document.createElement('div');
        document.body.appendChild(localContainer);
        const localRoot = createRoot(localContainer);
        const Publisher = ({ isActive }: { isActive: boolean }) => {
            useQueryEditorTabActivationPublisher('tab-d', isActive);
            return null;
        };
        await act(async () => {
            localRoot.render(createElement(
                'div',
                null,
                createElement(Publisher, { isActive: false }),
                createElement(Publisher, { isActive: true }),
            ));
        });
        // 一个激活 + 一个失活 → 聚合为激活
        expect(isQueryEditorTabActive('tab-d')).toBe(true);

        await act(async () => {
            localRoot.render(createElement(Publisher, { isActive: false }));
        });
        expect(isQueryEditorTabActive('tab-d')).toBe(false);

        await act(async () => localRoot.unmount());
        localContainer.remove();
        // 全部卸载后回到「未登记 = 激活」的兜底语义
        expect(isQueryEditorTabActive('tab-d')).toBe(true);
    });
});
