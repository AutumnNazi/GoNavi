/**
 * 工作台标签切换测量探针（可借鉴清单 #16，实验性，默认关闭）
 *
 * 测量「按下标签 → 目标 pane 可见首帧」整条链路，分四段打点（performance.now，毫秒）：
 *   pointerdown   标签头按下（document 捕获阶段，只读监听，不干预事件本身）
 *   storeCommit   store.activeTabId 已提交为目标 tab（同步提交段结束）
 *   commitFrame   提交后首个 rAF：此处强制读一次 pane 几何，量化 display:none → 可见 的
 *                 同步 style recalc + layout 成本（layoutMs）
 *   firstPaint    再下一帧：pane 可见首帧已绘制完成
 *
 * 样本写入 localStorage 环形缓冲 gonavi.perf.tabSwitch.v1（上限 120 条），
 * 控制台 window.__gonaviPerfHistory.exportTabSwitch() 导出 JSON。
 *
 * 开启方式（默认关闭，避免污染生产）：写入 gonavi.perf.tabSwitch.enabled = '1'；
 * dev 模式（import.meta.env.DEV）默认开启。开关经 1s TTL 缓存读取，改动即时生效。
 * 探针只读 DOM/几何与 store 通知，不改变任何行为。
 *
 * 「归因」的两条实现路线（与参考实现的关键差异，务必看清）：
 * 1. 订阅者扇出计时：包装 `useStore.subscribe` 给每个 listener 计时。**但要注意**
 *    zustand v4 的 React hook 走的是 `useSyncExternalStoreWithSelector(api.subscribe, ...)`，
 *    读的是闭包里那个 `api.subscribe`；`Object.assign(useBoundStore, api)` 只是把同一个函数
 *    **引用**拷到 hook 对象上。因此包装 `useStore.subscribe` 只能覆盖**命令式订阅方**
 *    （GoNavi 现有 7 处直接 `.subscribe(` 的模块），**覆盖不到**组件级 `useStore(selector)`。
 *    组件级成本改用下面的渲染计数（renders/renderPhases）归因，不要指望 subscriberMs 是全量扇出。
 * 2. 渲染计时：刻意**不用 React.Profiler**——生产版 React 不会触发 Profiler 的 onRender
 *    （仅 profiling bundle 有效，本项目未做别名），而切换卡顿恰恰要在用户侧生产构建里量。
 *    改为「渲染起点 + useLayoutEffect 终点」手工计时，语义接近 Profiler 的 actualDuration。
 */

import * as React from 'react';

/** 样本环形缓冲：达到上限后丢弃最旧样本。 */
const TAB_SWITCH_HISTORY_KEY = 'gonavi.perf.tabSwitch.v1';
const TAB_SWITCH_ENABLED_KEY = 'gonavi.perf.tabSwitch.enabled';
const TAB_SWITCH_HISTORY_MAX = 120;
/** 按下后超过该时长仍未等到 store 提交，视为「未触发切换」（拖拽排序/点已激活标签），丢弃样本。 */
const TAB_SWITCH_PENDING_TIMEOUT_MS = 3000;
/** 开关值的缓存时长：避免每次事件都读 localStorage。 */
const ENABLED_CACHE_TTL_MS = 1000;

/** rc-tabs 会把 key 中的英文双引号替换成这个占位串（见 rc-tabs/lib/util.js genDataNodeKey）。 */
const RC_TABS_DOUBLE_QUOTE = 'TABS_DQ';

/** 单次切换的四段打点（时间均为相对 pointerdown 的毫秒偏移，layoutMs 为绝对耗时）。 */
export interface TabSwitchPerfSample {
  ts: number;
  tabId: string;
  /** pointerdown → store 提交（含 React 同步渲染与 pane 类名翻转） */
  downToCommitMs: number;
  /** store 提交 → 提交帧 rAF（React 提交尾段 + 浏览器排期） */
  commitToFrameMs: number;
  /** 提交帧内强制同步 style + layout 的耗时（display:none → 可见 的重排成本） */
  layoutMs: number;
  /** 提交帧 → 首帧绘制完成（paint + 合成） */
  frameToPaintMs: number;
  /** pointerdown → 首帧绘制完成 总耗时 */
  totalMs: number;
  /** 归因：store 通知一轮内同步执行的命令式订阅者数量（不含组件级 useStore(selector)）。 */
  subscriberCount?: number;
  /** 归因：该轮全部命令式订阅者 listener 的同步执行总耗时（毫秒）。 */
  subscriberMs?: number;
  /** 归因：down → paint 窗口内各组件的渲染遍数。 */
  renders?: Record<string, number>;
  /** 归因：down → paint 窗口内各探针子树的渲染耗时合计（毫秒）。 */
  renderPhases?: Record<string, number>;
  /** 归因：提交帧时激活 pane 的 DOM 节点总数（衡量 display:none → 可见 的子树规模）。 */
  activePaneDomNodes?: number;
  /** 归因：提交帧时已挂载的 pane 总数。 */
  paneCount?: number;
}

/** 导出给诊断 UI 用，避免两处硬编码 key 漂移。 */
export const TAB_SWITCH_PROBE_HISTORY_KEY = TAB_SWITCH_HISTORY_KEY;
export const TAB_SWITCH_PROBE_ENABLED_KEY = TAB_SWITCH_ENABLED_KEY;
export const TAB_SWITCH_PROBE_HISTORY_MAX = TAB_SWITCH_HISTORY_MAX;

/**
 * zustand store 的最小结构。刻意只声明用到的两个方法、用结构类型而非 import store，
 * 避免「探针 → store → 探针」的模块环。
 *
 * subscribe 刻意用宽松的 `(...args: any[]) => void` 而非精确的 `(state, previousState)`：
 * zustand 的 subscribe 参数是 `(state: AppState, previousState: AppState) => void`，
 * 若这里声明成 `(state: unknown, previousState: unknown) => void`，strictFunctionTypes 下
 * 会因参数逆变（unknown 不可赋给 AppState）导致 `useStore` 传不进来。宽松签名既能兼容
 * 各种 store 形状，也便于包装层原样转发全部实参。
 */
export interface TabSwitchProbeStore {
  getState: () => { activeTabId: string | null };
  subscribe: (listener: (...args: any[]) => void) => () => void;
}

// ---------------------------------------------------------------- 开关

let cachedEnabled: boolean | null = null;
let cachedEnabledAt = 0;

/** 设置探针开关。开关在事件发生时现读（带 TTL 缓存），无需刷新即生效。 */
export const setTabSwitchProbeEnabled = (enabled: boolean): void => {
  cachedEnabled = enabled;
  cachedEnabledAt = Date.now();
  try {
    if (enabled) {
      localStorage.setItem(TAB_SWITCH_ENABLED_KEY, '1');
    } else {
      // 显式写 '0' 而非删除：dev 模式下「无 key」等于默认开启，删除键会开不回来。
      localStorage.setItem(TAB_SWITCH_ENABLED_KEY, '0');
    }
  } catch {
    // localStorage 不可用时静默忽略（本次会话内仍按内存缓存生效）
  }
};

/** 探针是否开启：显式开关优先，dev 模式默认开启。带 1s TTL 缓存，关闭路径近乎零开销。 */
export const isTabSwitchProbeEnabled = (): boolean => {
  const now = Date.now();
  if (cachedEnabled !== null && now - cachedEnabledAt < ENABLED_CACHE_TTL_MS) {
    return cachedEnabled;
  }
  let enabled: boolean | null = null;
  try {
    const raw = localStorage.getItem(TAB_SWITCH_ENABLED_KEY);
    if (raw === '1') enabled = true;
    else if (raw === '0') enabled = false;
  } catch {
    // localStorage 不可用（隐私模式）时只看 dev 标志
  }
  if (enabled === null) {
    enabled = Boolean((import.meta as any).env?.DEV);
  }
  cachedEnabled = enabled;
  cachedEnabledAt = now;
  return enabled;
};

/** 是否被**显式**开启（localStorage 写了 '1'），用于决定要不要把样本打到控制台。 */
const isExplicitlyEnabled = (): boolean => {
  try {
    return localStorage.getItem(TAB_SWITCH_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------- 落盘

const persistTabSwitchSample = (sample: TabSwitchPerfSample): void => {
  try {
    const raw = localStorage.getItem(TAB_SWITCH_HISTORY_KEY);
    let list: TabSwitchPerfSample[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = [];
      }
    }
    list.push(sample);
    while (list.length > TAB_SWITCH_HISTORY_MAX) {
      list.shift();
    }
    localStorage.setItem(TAB_SWITCH_HISTORY_KEY, JSON.stringify(list));
  } catch {
    // 落盘失败（隐私模式/配额）不影响切换本身
  }
};

/** 导出标签切换 perf 历史（控制台 window.__gonaviPerfHistory.exportTabSwitch()）。 */
export const exportTabSwitchHistory = (): string => {
  try {
    const raw = localStorage.getItem(TAB_SWITCH_HISTORY_KEY);
    return raw ? JSON.stringify(JSON.parse(raw), null, 2) : '[]';
  } catch {
    return '[]';
  }
};

/** 清空历史（诊断面板「清空」按钮用）。 */
export const clearTabSwitchHistory = (): void => {
  try {
    localStorage.removeItem(TAB_SWITCH_HISTORY_KEY);
  } catch {
    // 忽略
  }
};

// ---------------------------------------------------------------- 归因计数

/** 当前 down → paint 窗口内各组件渲染遍数（noteTabSwitchRender 累加）。 */
let renderCounts: Record<string, number> | null = null;
/** 当前 down → paint 窗口内各探针子树渲染耗时合计（noteTabSwitchRenderPhase 累加）。 */
let renderPhases: Record<string, number> | null = null;
/** 最近一次 store 通知轮的订阅者统计（listener 全部同步跑完即更新）。 */
let lastNotifyStats: { count: number; totalMs: number; at: number } = { count: 0, totalMs: 0, at: 0 };

/**
 * 组件渲染计数钩子。探针关闭时是一次空引用判断，开销可忽略。
 * 在需要统计渲染遍数的组件函数体顶部调用。
 */
export const noteTabSwitchRender = (component: string): void => {
  if (!renderCounts) return;
  renderCounts[component] = (renderCounts[component] || 0) + 1;
};

/** 探针子树耗时钩子（由 TabSwitchPhaseProfiler 调用）。 */
export const noteTabSwitchRenderPhase = (phase: string, durationMs: number): void => {
  if (!renderPhases) return;
  renderPhases[phase] = (renderPhases[phase] || 0) + durationMs;
};

/**
 * 包装 store.subscribe：为每个 listener 计时，聚合出「一次 setState 同步跑了多少个
 * 命令式订阅者、总共多久」——判断订阅扇出成本的直接证据。
 *
 * 两个必须注意的点：
 * 1. **必须原样转发 listener 参数**。GoNavi 的命令式订阅普遍写 `(state, previous)`，
 *    参考实现只调 `listener()`（丢参），会让这些订阅方读到 undefined 而失效。这里包一层
 *    转发全部实参，保证包装对调用方完全透明。
 * 2. 组件级 `useStore(selector)` 订阅读的是 zustand 内部 `api.subscribe`，
 *    不经过这里（见文件头注释），所以本统计只覆盖命令式订阅方。
 */
const instrumentStoreSubscribe = (store: TabSwitchProbeStore): TabSwitchProbeStore => {
  const target = store as TabSwitchProbeStore & { __tabSwitchSubscribeInstrumented?: boolean };
  if (target.__tabSwitchSubscribeInstrumented) return store;
  target.__tabSwitchSubscribeInstrumented = true;
  const originalSubscribe = store.subscribe.bind(store);
  target.subscribe = (listener: (...args: any[]) => void) =>
    originalSubscribe((...args: any[]) => {
      if (!isTabSwitchProbeEnabled()) {
        listener(...args);
        return;
      }
      const start = performance.now();
      listener(...args);
      const elapsed = performance.now() - start;
      // 同一次 setState 的所有 listener 同步连发；与上一轮相隔 >20ms 视为新一轮。
      const now = performance.now();
      if (now - lastNotifyStats.at > 20) {
        lastNotifyStats = { count: 0, totalMs: 0, at: now };
      }
      lastNotifyStats.count += 1;
      lastNotifyStats.totalMs += elapsed;
      lastNotifyStats.at = now;
    });
  return store;
};

/**
 * 探针门控的子树渲染计时包装（零 JSX，本文件保持 .ts）。
 * 组件**恒挂载**：探针关闭时仅多一个空 fiber 与一次开关读取，避免开关切换导致
 * pane 子树 remount（Monaco/DataGrid 重建的代价远大于这点开销）。
 * 计时结果按 phase 累加进样本的 renderPhases 字段。
 */
export const TabSwitchPhaseProfiler: React.FC<{ phase: string; children: React.ReactNode }> = ({
  phase,
  children,
}) => {
  // 探针关闭时 startAt 恒为 0，layout effect 内直接跳过（不写样本）。
  const startAt = isTabSwitchProbeEnabled() ? performance.now() : 0;
  React.useLayoutEffect(() => {
    if (startAt > 0) {
      noteTabSwitchRenderPhase(phase, performance.now() - startAt);
    }
  });
  return React.createElement(React.Fragment, null, children);
};

// ---------------------------------------------------------------- 安装

let installed = false;
/**
 * 已注册的 pointerdown 处理器引用。留引用只为「可卸载」：document 级监听不会随
 * 组件卸载消失，若重复安装而不摘除，会叠加多份监听导致同一次切换被记多次。
 */
let installedPointerHandler: ((event: PointerEvent) => void) | null = null;

/** 把 data-node-key 还原成真实 key（rc-tabs 把 `"` 换成了 TABS_DQ）。 */
const decodeTabNodeKey = (raw: string): string => raw.split(RC_TABS_DOUBLE_QUOTE).join('"');

/** 合并进既有 __gonaviPerfHistory（与其它诊断导出共存），不覆盖已有字段。 */
const exposePerfHistory = (): void => {
  const w = window as any;
  w.__gonaviPerfHistory = w.__gonaviPerfHistory || {};
  w.__gonaviPerfHistory.exportTabSwitch = exportTabSwitchHistory;
  w.__gonaviPerfHistory.clearTabSwitch = clearTabSwitchHistory;
  w.__gonaviPerfHistory.isTabSwitchProbeEnabled = isTabSwitchProbeEnabled;
  w.__gonaviPerfHistory.setTabSwitchProbeEnabled = setTabSwitchProbeEnabled;
};

/**
 * 安装探针（幂等）。由标签管理链路的 hook 模块装载时调用一次。
 * pointerdown 与 store 提交之间可能夹着一段同步渲染；提交后用两个 rAF
 * 卡住「提交帧」与「首帧绘制完成」两个时间点。
 */
export const installTabSwitchProbe = (store: TabSwitchProbeStore): void => {
  if (installed) return;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (typeof requestAnimationFrame !== 'function') return;
  installed = true;

  // 先留一份未被计时的 subscribe：探针自身的提交监听必须走它，否则探针会把自己
  // 也算进 subscriberCount/subscriberMs，给扇出归因引入固定偏置。
  const originalSubscribe = store.subscribe.bind(store);
  // 包装订阅统计（自身幂等）：必须赶在其它命令式订阅方注册之前完成，否则漏统计。
  const meteredStore = instrumentStoreSubscribe(store);
  exposePerfHistory();

  let pending: { tabId: string; downAt: number } | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const dropPending = () => {
    pending = null;
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  // 第一段：标签头按下（捕获阶段，被动监听，不阻止也不延迟事件）。
  const handlePointerDown = (event: PointerEvent) => {
    if (!isTabSwitchProbeEnabled()) return;
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    const tabEl = typeof target?.closest === 'function'
      ? target.closest('.main-tabs .ant-tabs-tab')
      : null;
    const rawKey = String(tabEl?.getAttribute('data-node-key') || '').trim();
    if (!rawKey) return;
    const tabId = decodeTabNodeKey(rawKey);
    // 点已激活标签不会触发切换，直接忽略，避免污染样本。
    if (meteredStore.getState().activeTabId === tabId) return;
    dropPending();
    pending = { tabId, downAt: performance.now() };
    renderCounts = {};
    renderPhases = {};
    pendingTimer = setTimeout(dropPending, TAB_SWITCH_PENDING_TIMEOUT_MS);
  };
  document.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
  installedPointerHandler = handlePointerDown;

  // 第二段：store 提交（zustand 的 subscribe 在 setState 内同步触发）。
  // 走未经计时的 originalSubscribe，避免把探针自身计入订阅者统计。
  originalSubscribe((state: unknown) => {
    if (!pending) return;
    const activeTabId = (state as { activeTabId?: string | null } | null)?.activeTabId
      ?? meteredStore.getState().activeTabId;
    if (activeTabId !== pending.tabId) return;
    const { tabId, downAt } = pending;
    dropPending();
    const commitAt = performance.now();

    // 第三段：提交后首个 rAF（浏览器渲染前），强制同步 style + layout 计时。
    requestAnimationFrame(() => {
      const frameAt = performance.now();
      const paneMetrics = measureActivePaneLayout();

      // 第四段：再下一帧，pane 可见首帧已上屏。
      requestAnimationFrame(() => {
        const paintAt = performance.now();
        const sample: TabSwitchPerfSample = {
          ts: Date.now(),
          tabId,
          downToCommitMs: round1(commitAt - downAt),
          commitToFrameMs: round1(frameAt - commitAt),
          layoutMs: round1(paneMetrics.layoutMs),
          frameToPaintMs: round1(paintAt - frameAt),
          totalMs: round1(paintAt - downAt),
          // 归因快照：订阅者统计取最近一轮（rAF 时刻该轮已跑完），渲染计数取整个窗口累计。
          subscriberCount: lastNotifyStats.count,
          subscriberMs: round1(lastNotifyStats.totalMs),
          renders: renderCounts ? { ...renderCounts } : undefined,
          renderPhases: renderPhases ? round1Record(renderPhases) : undefined,
          activePaneDomNodes: paneMetrics.activePaneDomNodes,
          paneCount: paneMetrics.paneCount,
        };
        renderCounts = null;
        renderPhases = null;
        persistTabSwitchSample(sample);
        // 仅在「显式写入开关」时打印：dev 默认开启的场景（含单测）会高频落样本，
        // 若按 DEV 判断会刷屏，故这里以 localStorage 是否显式开启为准。
        if (isExplicitlyEnabled()) {
          // eslint-disable-next-line no-console
          console.debug('[tab-switch]', sample);
        }
      });
    });
  });
};

interface ActivePaneMetrics {
  /** 强制同步布局耗时（display:none → 可见 的重排成本）。 */
  layoutMs: number;
  /** 激活 pane 的 DOM 节点总数（决定这次重排/重绘的规模上限）。 */
  activePaneDomNodes?: number;
  /** 已挂载的 pane 总数。 */
  paneCount?: number;
}

/**
 * 量化「激活 pane 变可见」那一刻的同步布局成本。
 * 读 getBoundingClientRect 会强制浏览器立即完成该子树的 style recalc + layout——
 * 这正是 display:none → 可见 那一步的真实代价，也是切换卡顿的常见来源。
 * 全程只读，失败时返回零值，绝不影响切换本身。
 */
const measureActivePaneLayout = (): ActivePaneMetrics => {
  let layoutMs = 0;
  let activePaneDomNodes: number | undefined;
  let paneCount: number | undefined;
  try {
    // 选「非 hidden」的 pane：hidden 类名由 rc-motion 的 leavedClassName 提供，
    // 与 GoNavi 自己的 .main-tabs .ant-tabs-tabpane-hidden 规则一致。
    const pane = document.querySelector(
      '.main-tabs .ant-tabs-tabpane:not(.ant-tabs-tabpane-hidden)',
    );
    if (pane) {
      const layoutStart = performance.now();
      void (pane as HTMLElement).getBoundingClientRect();
      layoutMs = performance.now() - layoutStart;
      activePaneDomNodes = pane.querySelectorAll('*').length;
    }
    paneCount = document.querySelectorAll('.main-tabs .ant-tabs-tabpane').length;
  } catch {
    // 几何读取失败不影响测量主链路
  }
  return { layoutMs, activePaneDomNodes, paneCount };
};

/** 保留 1 位小数，样本体积可控且精度足够。 */
const round1 = (value: number): number => Math.round(value * 10) / 10;

const round1Record = (record: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = round1(value);
  }
  return out;
};

/**
 * 测试专用：卸载探针（摘掉 document 监听、复位安装标志与归因缓存），
 * 让每个用例都能从干净状态重新安装。生产不要调用。
 */
export const resetTabSwitchProbeForTests = (): void => {
  if (installedPointerHandler && typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', installedPointerHandler, { capture: true });
  }
  installedPointerHandler = null;
  installed = false;
  renderCounts = null;
  renderPhases = null;
  lastNotifyStats = { count: 0, totalMs: 0, at: 0 };
  cachedEnabled = null;
  cachedEnabledAt = 0;
};
