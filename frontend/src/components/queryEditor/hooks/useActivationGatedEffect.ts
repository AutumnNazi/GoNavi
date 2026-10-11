import { useEffect, useRef, type MutableRefObject } from 'react';

/**
 * 非激活 tab 副作用瘦身：把「window 监听常驻 + 回调内 if (!isActive) return 早退」
 * 改成「随激活挂/拆」。
 *
 * 为什么抽成独立文件：QueryEditor 下多个 hooks 与编辑器事件绑定要复用同一套门控语义，
 * 分散实现会让「失活到底拆不拆监听」在不同文件里各自漂移，也无法单点验证。
 *
 * 与 yxdb 参考实现的差异（有意为之，勿照搬）：yxdb 的 isActive 只作 ref 初始值、之后由
 * store 订阅命令式翻转，所以它的门控函数需要 activationListenersRef 那套广播；GoNavi 的
 * isActive 仍是渲染期 prop，翻转必然带来一次重渲染，useEffect 的 deps 变化本身承担了
 * 「翻转通知」职责，因此这里不需要广播集合。代价是 deps 必须含 isActive——这是本次改造刻意
 * 保留的渲染期契约，不做整体 ref 化（会牵动 WorkbenchTabContent 的 memo 与全部 hook）。
 *
 * 返回的 isActiveRef 供回调内部做二次门控：部分调用点除 isActive 外的 deps 为空数组，
 * 闭包只捕获首帧的 isActive，必须靠 ref 读最新值。
 */
/**
 * 渲染期同步的激活态 ref。
 *
 * 单独导出（而非只藏在 useActivationGatedEffect 内部）是为了让同一 hook 内的多处 effect 共用
 * 一个 ref：调用点可以在所有 effect 之前声明一次，各处回调读到的都是同一份最新值，
 * 无需在每个 effect 里各自接一个返回值，也避免「后面的 effect 引用前面 const」的书写顺序约束。
 */
export const useQueryEditorActivationRef = (isActive: boolean): MutableRefObject<boolean> => {
    const isActiveRef = useRef(isActive);
    // 渲染期同步：同一帧的 effect 阶段读取，拿到的必然是最新值。
    isActiveRef.current = isActive;
    return isActiveRef;
};

export const useActivationGatedEffect = (
    isActive: boolean,
    effect: () => void | (() => void),
    deps: readonly unknown[],
): MutableRefObject<boolean> => {
    const isActiveRef = useQueryEditorActivationRef(isActive);
    // 内联 effect 每次渲染都是新引用，用 ref 持有，避免把它塞进 deps 导致每帧重跑。
    const effectRef = useRef(effect);
    effectRef.current = effect;
    useEffect(() => {
        if (!isActiveRef.current) {
            // 失活：不挂监听、不发请求。翻转时 React 会先跑上一次的 cleanup 再执行本次。
            return undefined;
        }
        return effectRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由调用点按「除 isActive 外还影响本 effect 的因素」显式给出
    }, [isActive, ...deps]);
    return isActiveRef;
};

/**
 * 两张表刻意分开：订阅行为本身不得改变「该 tab 是否激活」的判定，否则「订阅了但还没发布」
 * 的中间态会被误判为失活，与「未知即激活」的失败方向相悖。
 */
const activationTokensByTabId = new Map<string, Set<symbol>>();
const activationListenersByTabId = new Map<string, Set<() => void>>();

const notifyQueryEditorTabActivation = (tabId: string): void => {
    const listeners = activationListenersByTabId.get(tabId);
    if (!listeners) {
        return;
    }
    // 复制一份再遍历：订阅方回调里可能同步退订，直接遍历会改动正在迭代的集合。
    [...listeners].forEach((listener) => {
        try {
            listener();
        } catch {
            // 单个订阅方抛错不得影响其它订阅方与调用方
        }
    });
};

/** 无 token 登记即视为激活（见上文失败方向说明）。 */
export const isQueryEditorTabActive = (tabId: string): boolean => {
    const tokens = activationTokensByTabId.get(tabId);
    return !tokens || tokens.size > 0;
};

/** token 与订阅方都清空时才回收表项，避免长会话下每个关闭过的 tab 留下空集合。 */
const collectQueryEditorTabActivation = (tabId: string): void => {
    if ((activationTokensByTabId.get(tabId)?.size ?? 0) === 0
        && (activationListenersByTabId.get(tabId)?.size ?? 0) === 0) {
        activationTokensByTabId.delete(tabId);
        activationListenersByTabId.delete(tabId);
    }
};

export const publishQueryEditorTabActivation = (tabId: string, token: symbol, active: boolean): void => {
    // 变化前后都按聚合判定取，才能覆盖「无 token(激活) → 显式失活」这一次翻转
    const wasActive = isQueryEditorTabActive(tabId);
    const tokens = activationTokensByTabId.get(tabId) ?? new Set<symbol>();
    if (active) {
        tokens.add(token);
    } else {
        tokens.delete(token);
    }
    activationTokensByTabId.set(tabId, tokens);
    // 只在聚合结果真的翻转时通知，避免同 tab 多实例互相扰动订阅方
    if (wasActive !== isQueryEditorTabActive(tabId)) {
        notifyQueryEditorTabActivation(tabId);
    }
    // 刻意不在这里回收空集合：token 归零本身就是「已知失活」的证据，回收会让该 tab
    // 退回「未登记 = 激活」，把刚发布的失活状态丢掉。回收只在 release / unsubscribe 里做。
};

const releaseQueryEditorTabActivation = (tabId: string, token: symbol): void => {
    const tokens = activationTokensByTabId.get(tabId);
    if (!tokens) {
        return;
    }
    // 不因 delete 返回 false 提前退出：失活期间该 token 本就不在集合里，
    // 提前退出会把空集合留在表中，令该 tab 永久停留在「已知失活」。
    const wasActive = tokens.size > 0;
    tokens.delete(token);
    if (wasActive !== isQueryEditorTabActive(tabId)) {
        notifyQueryEditorTabActivation(tabId);
    }
    collectQueryEditorTabActivation(tabId);
};

export const subscribeQueryEditorTabActivation = (tabId: string, listener: () => void): (() => void) => {
    const listeners = activationListenersByTabId.get(tabId) ?? new Set<() => void>();
    listeners.add(listener);
    activationListenersByTabId.set(tabId, listeners);
    return () => {
        if (!listeners.delete(listener)) {
            return;
        }
        collectQueryEditorTabActivation(tabId);
    };
};

/**
 * 把渲染期 isActive 发布到通道。
 * 发布放在 effect（而非渲染期）里：订阅方收到通知时会同步增删 window 监听，
 * 渲染期触发这类副作用会撞上 React 的「渲染期不得产生副作用」约束。
 */
export const useQueryEditorTabActivationPublisher = (tabId: string, isActive: boolean): void => {
    const tokenRef = useRef<symbol | null>(null);
    if (!tokenRef.current) {
        tokenRef.current = Symbol('query-editor-activation');
    }
    const token = tokenRef.current;
    useEffect(() => {
        publishQueryEditorTabActivation(tabId, token, isActive);
    }, [tabId, token, isActive]);
    // 卸载只回收自己的 token：同 tab 的其它实例（分离窗口）仍可能在挂载中。
    useEffect(() => () => {
        releaseQueryEditorTabActivation(tabId, token);
    }, [tabId, token]);
};
