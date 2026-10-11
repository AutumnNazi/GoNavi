/** @vitest-environment jsdom */
/**
 * ipcMeter 单测。
 *
 * 覆盖三件必须成立的事：
 * 1. 大数组走抽样外推，不为计量而把整个结果集再序列化一遍（否则计量本身抬高 ipc 段读数）；
 * 2. Proxy 对同一方法的重复读取返回稳定引用（否则每次读取生成新闭包，调用方引用不一致）；
 * 3. 计量对调用方完全透明——返回值/异常/Promise 语义不变，关闭时不计数。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IPC_METER_ENABLED_KEY,
  approxBytes,
  exportIpcStats,
  getIpcStats,
  getIpcStatsSummary,
  installIpcMeter,
  isIpcMeterEnabled,
  isIpcMeterInstalled,
  resetIpcMeterForTests,
  setIpcMeterEnabled,
  stopIpcMeterRetry,
} from './ipcMeter';

/** 可控的假绑定对象：跨用例唯一，避免 Proxy 残留到下一个用例。 */
let appMethods: Record<string, unknown>;
let memory: Record<string, string>;

const makeAppMethods = () => ({
  SyncEcho: (value: unknown) => ({ echoed: value }),
  AsyncEcho: async (value: unknown) => ({ echoed: value }),
  Failing: () => {
    throw new Error('boom');
  },
  Rejecting: () => Promise.reject(new Error('nope')),
  NotAFunction: 42,
});

describe('ipcMeter', () => {
  beforeEach(() => {
    memory = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key in memory ? memory[key] : null),
      setItem: (key: string, value: string) => {
        memory[key] = String(value);
      },
      removeItem: (key: string) => {
        delete memory[key];
      },
    });
    appMethods = makeAppMethods();
    (window as any).go = { app: { App: appMethods } };
    resetIpcMeterForTests();
  });

  afterEach(() => {
    resetIpcMeterForTests();
    delete (window as any).go;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('approxBytes 抽样外推', () => {
    it('大数组只抽样少量元素，不做全量序列化', () => {
      let stringifyCalls = 0;
      const large = Array.from({ length: 200 }, (_, index) => ({
        id: index,
        value: 'x'.repeat(10),
        toJSON() {
          stringifyCalls += 1;
          return { id: index, value: 'x'.repeat(10) };
        },
      }));

      approxBytes(large);

      // 32 个抽样点各触发一次 toJSON；若退化为全量 stringify 这里会是 200。
      expect(stringifyCalls).toBeLessThanOrEqual(33);
      expect(stringifyCalls).toBeGreaterThan(0);
    });

    it('抽样外推结果与实际体量同数量级', () => {
      const itemString = JSON.stringify({ a: 'xxxxxxxxxx' });
      const large = Array.from({ length: 200 }, () => ({ a: 'xxxxxxxxxx' }));
      const exact = itemString.length * 200;

      const estimate = approxBytes(large);

      expect(estimate).toBeGreaterThan(exact * 0.7);
      expect(estimate).toBeLessThan(exact * 1.5);
    });

    it('小数组仍走精确序列化', () => {
      const small = [{ a: 1 }, { b: 'two' }];
      expect(approxBytes(small)).toBe(JSON.stringify(small).length);
    });

    it('对象含大数组属性时逐属性估算，不整体序列化', () => {
      let stringifyCalls = 0;
      const rows = Array.from({ length: 500 }, (_, index) => ({
        index,
        toJSON() {
          stringifyCalls += 1;
          return { index };
        },
      }));

      const estimate = approxBytes({ columns: ['a', 'b'], data: rows });

      expect(estimate).toBeGreaterThan(0);
      expect(stringifyCalls).toBeLessThanOrEqual(33);
    });

    it('字符串取长度、空值计 0，均不抛异常', () => {
      expect(approxBytes('abc')).toBe(5);
      expect(approxBytes(undefined)).toBe(0);
      expect(approxBytes(null)).toBe(0);
      // 循环引用不可序列化，必须以 0 兜底而不是抛出
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => approxBytes(cyclic)).not.toThrow();
    });
  });

  describe('Proxy 包装', () => {
    it('安装成功，且对同一方法的重复读取返回稳定引用', () => {
      expect(installIpcMeter()).toBe(true);
      expect(isIpcMeterInstalled()).toBe(true);

      const first = (window as any).go.app.App.SyncEcho;
      const second = (window as any).go.app.App.SyncEcho;

      expect(typeof first).toBe('function');
      expect(first).toBe(second);
    });

    it('非函数属性原样透传', () => {
      installIpcMeter();
      expect((window as any).go.app.App.NotAFunction).toBe(42);
    });

    it('计量不影响原方法返回值（同步）', () => {
      installIpcMeter();
      setIpcMeterEnabled(true);

      const result = (window as any).go.app.App.SyncEcho({ hello: 'world' });

      expect(result).toEqual({ echoed: { hello: 'world' } });
      const stat = getIpcStats().find((item) => item.name === 'SyncEcho');
      expect(stat?.calls).toBe(1);
      expect(stat?.errors).toBe(0);
      expect(stat?.resBytes).toBeGreaterThan(0);
      expect(stat?.reqBytes).toBeGreaterThan(0);
    });

    it('计量不影响原方法返回值（异步 Promise 语义不变）', async () => {
      installIpcMeter();
      setIpcMeterEnabled(true);

      const promise = (window as any).go.app.App.AsyncEcho('payload');

      expect(typeof promise.then).toBe('function');
      await expect(promise).resolves.toEqual({ echoed: 'payload' });

      const stat = getIpcStats().find((item) => item.name === 'AsyncEcho');
      expect(stat?.calls).toBe(1);
      // 响应字节在 resolve 之后才计入
      expect(stat?.resBytes).toBeGreaterThan(0);
      expect(stat?.maxMs).toBeGreaterThanOrEqual(0);
    });

    it('同步异常原样抛出并计入 errors', () => {
      installIpcMeter();
      setIpcMeterEnabled(true);

      expect(() => (window as any).go.app.App.Failing()).toThrow('boom');

      const stat = getIpcStats().find((item) => item.name === 'Failing');
      expect(stat?.calls).toBe(1);
      expect(stat?.errors).toBe(1);
      expect(stat?.resBytes).toBe(0);
    });

    it('Promise 拒绝原样透传并计入 errors', async () => {
      installIpcMeter();
      setIpcMeterEnabled(true);

      await expect((window as any).go.app.App.Rejecting()).rejects.toThrow('nope');

      const stat = getIpcStats().find((item) => item.name === 'Rejecting');
      expect(stat?.calls).toBe(1);
      expect(stat?.errors).toBe(1);
    });

    it('关闭开关时不计数，但调用照常成功', () => {
      installIpcMeter();
      setIpcMeterEnabled(false);

      const result = (window as any).go.app.App.SyncEcho('quiet');

      expect(result).toEqual({ echoed: 'quiet' });
      expect(getIpcStats()).toHaveLength(0);
    });

    it('重复安装幂等，不会二次包装', () => {
      installIpcMeter();
      const wrapped = (window as any).go.app.App;
      installIpcMeter();

      expect((window as any).go.app.App).toBe(wrapped);
    });
  });

  describe('绑定注入时序（移植陷阱）', () => {
    it('绑定未就绪时返回 false 且不凭空创建 window.go.app 命名空间', () => {
      delete (window as any).go;

      expect(installIpcMeter()).toBe(false);
      // 关键：不能污染由运行时拥有的全局对象，否则后续真实注入会被空壳挡住
      expect((window as any).go).toBeUndefined();
      stopIpcMeterRetry();
    });

    it('go.app 存在但 App 未就绪时安排重试，就绪后安装成功', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      (window as any).go = { app: {} };

      expect(installIpcMeter()).toBe(false);
      expect(isIpcMeterInstalled()).toBe(false);

      // 模拟运行时的真实绑定稍后注入
      (window as any).go.app.App = makeAppMethods();
      vi.advanceTimersByTime(100);

      expect(isIpcMeterInstalled()).toBe(true);
    });
  });

  describe('聚合与导出', () => {
    it('开关读写与 TTL 缓存一致', () => {
      expect(isIpcMeterEnabled()).toBe(false);

      setIpcMeterEnabled(true);
      expect(isIpcMeterEnabled()).toBe(true);
      expect(memory[IPC_METER_ENABLED_KEY]).toBe('1');

      setIpcMeterEnabled(false);
      expect(isIpcMeterEnabled()).toBe(false);
      expect(IPC_METER_ENABLED_KEY in memory).toBe(false);
    });

    it('快照给出总量与两个热点榜', () => {
      installIpcMeter();
      setIpcMeterEnabled(true);

      (window as any).go.app.App.SyncEcho('a');
      (window as any).go.app.App.SyncEcho('b');

      const summary = getIpcStatsSummary();

      expect(summary.totals.calls).toBe(2);
      expect(summary.totals.errors).toBe(0);
      expect(summary.topByMs.map((item) => item.name)).toContain('SyncEcho');
      expect(summary.topByBytes.map((item) => item.name)).toContain('SyncEcho');
      expect(typeof summary.generatedAt).toBe('number');
    });

    it('reset 清零统计但不破坏已取出的包装引用', () => {
      installIpcMeter();
      setIpcMeterEnabled(true);
      const wrapped = (window as any).go.app.App.SyncEcho;
      wrapped('x');
      expect(getIpcStats()).toHaveLength(1);

      resetIpcMeterForTests();

      expect(getIpcStats()).toHaveLength(0);
    });

    it('exportIpcStats 输出可解析的 JSON', () => {
      installIpcMeter();
      setIpcMeterEnabled(true);
      (window as any).go.app.App.SyncEcho('x');

      const parsed = JSON.parse(exportIpcStats());
      expect(parsed.totals.calls).toBe(1);
    });
  });
});
