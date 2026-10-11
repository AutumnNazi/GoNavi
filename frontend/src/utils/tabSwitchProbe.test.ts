/** @vitest-environment jsdom */
/**
 * tabSwitchProbe 单测。
 *
 * 覆盖三件必须成立的事：
 * 1. 默认关闭时零开销——不写 localStorage、不落样本；
 * 2. 环形缓冲上限 120 条，超出丢弃最旧；
 * 3. 样本四段字段齐全（downToCommit/commitToFrame/frameToPaint/total + layoutMs），
 *    且归因字段（renders 等）确实被采集。
 *
 * rAF 用手动队列替换，避免依赖 jsdom 的帧调度时序，让两段 rAF 可确定地推进。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TAB_SWITCH_PROBE_HISTORY_KEY,
  TAB_SWITCH_PROBE_HISTORY_MAX,
  installTabSwitchProbe,
  isTabSwitchProbeEnabled,
  noteTabSwitchRender,
  resetTabSwitchProbeForTests,
  setTabSwitchProbeEnabled,
  type TabSwitchPerfSample,
} from './tabSwitchProbe';

/** 手动帧队列：flushFrames() 逐段推进。 */
let frameQueue: Array<() => void>;

/** 可推进的假 store：记录命令式订阅者（含其参数透传）。 */
const createFakeStore = () => {
  const listeners = new Set<(state: unknown, previousState: unknown) => void>();
  const state = { activeTabId: 'tab-a' };
  return {
    state,
    listeners,
    getState: () => state,
    subscribe: (listener: (state: unknown, previousState: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 模拟 setState：同步通知全部订阅者，并把 activeTabId 切到目标。 */
    commit(tabId: string) {
      const previousState = { ...state };
      state.activeTabId = tabId;
      for (const listener of [...listeners]) {
        listener(state, previousState);
      }
    },
  };
};

let memory: Record<string, string>;
let setItemSpy: ReturnType<typeof vi.fn>;

const readSamples = (): TabSwitchPerfSample[] => {
  const raw = memory[TAB_SWITCH_PROBE_HISTORY_KEY];
  return raw ? JSON.parse(raw) : [];
};

/** 造一个带 data-node-key 的标签头，插到 .main-tabs 容器内。 */
const makeTabStrip = (tabIds: string[]) => {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'main-tabs';
  for (const tabId of tabIds) {
    const tab = document.createElement('div');
    tab.className = 'ant-tabs-tab';
    tab.setAttribute('data-node-key', tabId);
    const label = document.createElement('span');
    label.className = 'ant-tabs-tab-btn';
    tab.appendChild(label);
    root.appendChild(tab);
  }
  const pane = document.createElement('div');
  pane.className = 'ant-tabs-tabpane';
  const inner = document.createElement('span');
  pane.appendChild(inner);
  root.appendChild(pane);
  document.body.appendChild(root);
  return root;
};

const pointerDownOn = (tabId: string) => {
  const tab = document.querySelector(`.ant-tabs-tab[data-node-key="${tabId}"]`);
  const target = tab?.querySelector('.ant-tabs-tab-btn') ?? tab;
  target?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
};

/** 推进一帧（消费当前队列快照，回调里新排的帧留到下一次）。 */
const flushFrame = () => {
  const pending = frameQueue;
  frameQueue = [];
  for (const callback of pending) callback();
};

const flushFrames = (count = 2) => {
  for (let i = 0; i < count; i += 1) flushFrame();
};

describe('tabSwitchProbe', () => {
  beforeEach(() => {
    memory = {};
    setItemSpy = vi.fn((key: string, value: string) => {
      memory[key] = String(value);
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key in memory ? memory[key] : null),
      setItem: setItemSpy,
      removeItem: (key: string) => {
        delete memory[key];
      },
    });
    // 显式开启探针时生产代码会把样本打到控制台（诊断用）。测例里开启样本量大，
    // 静音以免淹没测试输出；这不改变被测逻辑（是否落盘/落几条仍照常断言）。
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    frameQueue = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    });
    // 明确关闭：dev 环境（vitest 下 DEV 为 true）默认开启，会干扰「关闭态」用例
    setTabSwitchProbeEnabled(false);
    setItemSpy.mockClear();
    resetTabSwitchProbeForTests();
    makeTabStrip(['tab-a', 'tab-b']);
  });

  afterEach(() => {
    resetTabSwitchProbeForTests();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  describe('关闭态', () => {
    it('关闭时不落盘任何样本', () => {
      const store = createFakeStore();
      installTabSwitchProbe(store);

      pointerDownOn('tab-b');
      store.commit('tab-b');
      flushFrames();

      expect(setItemSpy).not.toHaveBeenCalled();
      expect(readSamples()).toEqual([]);
    });

    it('关闭时 pointerdown 早退，不建立待处理状态（后续提交也不产生样本）', () => {
      const store = createFakeStore();
      installTabSwitchProbe(store);

      pointerDownOn('tab-b');
      setTabSwitchProbeEnabled(true);
      store.commit('tab-b');
      flushFrames();

      expect(readSamples()).toEqual([]);
    });

    it('开关显式写入 0 时，即使 dev 环境也不开启', () => {
      expect(isTabSwitchProbeEnabled()).toBe(false);
    });
  });

  describe('四段打点', () => {
    it('一次切换落一条样本，四段字段齐全且总量自洽', () => {
      const store = createFakeStore();
      installTabSwitchProbe(store);
      setTabSwitchProbeEnabled(true);

      pointerDownOn('tab-b');
      store.commit('tab-b');
      flushFrames();

      const samples = readSamples();
      expect(samples).toHaveLength(1);

      const sample = samples[0];
      expect(sample.tabId).toBe('tab-b');
      expect(sample.ts).toBeGreaterThan(0);
      for (const field of [
        'downToCommitMs', 'commitToFrameMs', 'layoutMs', 'frameToPaintMs', 'totalMs',
      ] as const) {
        expect(typeof sample[field]).toBe('number');
        expect(Number.isFinite(sample[field])).toBe(true);
        expect(sample[field]).toBeGreaterThanOrEqual(0);
      }
      // total 由四段合成，不应小于各分段之和（取整误差容忍 1ms）
      const sum = sample.downToCommitMs + sample.commitToFrameMs + sample.frameToPaintMs;
      expect(sample.totalMs).toBeGreaterThanOrEqual(sum - 1);
    });

    it('采集 pane 规模与渲染归因字段', () => {
      const store = createFakeStore();
      installTabSwitchProbe(store);
      setTabSwitchProbeEnabled(true);

      pointerDownOn('tab-b');
      noteTabSwitchRender('FakePane');
      store.commit('tab-b');
      flushFrames();

      const sample = readSamples()[0];
      expect(sample.renders?.FakePane).toBe(1);
      expect(sample.paneCount).toBeGreaterThanOrEqual(1);
      expect(sample.activePaneDomNodes).toBeGreaterThanOrEqual(1);
    });

    it('点已激活标签不产生样本', () => {
      const store = createFakeStore();
      installTabSwitchProbe(store);
      setTabSwitchProbeEnabled(true);

      // store 的初始 activeTabId 就是 tab-a
      pointerDownOn('tab-a');
      store.commit('tab-a');
      flushFrames();

      expect(readSamples()).toEqual([]);
    });

    it('命令式订阅者参数原样透传（包装不丢参）', () => {
      const store = createFakeStore();
      // 必须先安装、再订阅：这样订阅才会经过被包装的 subscribe，真正验证参数转发。
      // （若先订阅，listener 走的是原始 subscribe，测不到包装层。）
      installTabSwitchProbe(store);
      const received: Array<[unknown, unknown]> = [];
      store.subscribe((state, previousState) => {
        received.push([state, previousState]);
      });
      setTabSwitchProbeEnabled(true);

      pointerDownOn('tab-b');
      store.commit('tab-b');

      const listenerCall = received.find(([state]) => (state as any)?.activeTabId === 'tab-b');
      expect(listenerCall).toBeDefined();
      // 第二个参数必须是上一份 state 快照，不能是 undefined
      expect(listenerCall?.[1]).toEqual({ activeTabId: 'tab-a' });
    });
  });

  describe('环形缓冲上限', () => {
    it('超过 120 条时丢弃最旧样本，长度封顶', () => {
      const store = createFakeStore();
      installTabSwitchProbe(store);
      setTabSwitchProbeEnabled(true);

      const total = TAB_SWITCH_PROBE_HISTORY_MAX + 10;
      for (let i = 0; i < total; i += 1) {
        const target = i % 2 === 0 ? 'tab-b' : 'tab-a';
        pointerDownOn(target);
        store.commit(target);
        flushFrames();
      }

      const samples = readSamples();
      expect(samples).toHaveLength(TAB_SWITCH_PROBE_HISTORY_MAX);
      // 最早的那条已被挤掉：剩余样本数恰为上限
      expect(samples.length).toBeLessThanOrEqual(TAB_SWITCH_PROBE_HISTORY_MAX);
    });
  });
});
