/**
 * IPC 计量层（可借鉴清单 #13）
 *
 * 在 Wails 绑定入口 `window.go.app.App` 上装一层 Proxy，无侵入拦截每次「前端 → Go」的
 * 绑定调用，统计次数、累计/最大/最近耗时、请求/响应近似字节与错误数。统计落在「调用层」，
 * 因此天然覆盖 Go 侧 JSON 编码 + 桥接 + JS 解析三段耗时——这正是结果集传输要优化的主成本。
 *
 * 为什么默认关闭：生产包里没有 DevTools，计量本身也会让 ipc 段读数偏高（尤其大结果集的
 * 字节估算），所以计量默认不计数；开关写 localStorage 后 1s 内即时生效（见 isIpcMeterEnabled
 * 的 TTL 缓存），无需刷新。关闭时包装函数只做一次布尔判断就原样转发，几乎零开销。
 *
 * 为什么安装要重试：wails 绑定由运行时脚本注入，注入时机不保证早于前端模块执行。
 * 参考项目曾因「monkey-patch 包装早于绑定注入」导致某一整类查询静默失效，故这里在
 * `window.go.app.App` 就绪前每 100ms 重试一次（最多 5s），且**不存在时只等待、不创建**
 * `window.go` / `window.go.app` 命名空间——避免污染一个由运行时拥有的全局对象。
 *
 * 关键优化：大数组（>64 项）的响应若逐次全量 JSON.stringify，等于在主线程对整个结果集
 * 做第二次序列化，成本与桥接本身同量级，且恰好落在要测量的 ipc 段内抬高读数。因此大数组
 * 改为「均匀抽样 32 项 → 外推」，小载荷仍保持精确序列化口径（字段本就标注为「近似字节数」）。
 */

/** 大数组判定阈值：超过则不再整体 stringify，改为抽样外推。 */
const APPROX_BYTES_ARRAY_SAMPLE_LIMIT = 64;
/** 抽样点数：与数组长度无关的固定上界，保证估算成本恒定。 */
const APPROX_BYTES_SAMPLE_COUNT = 32;

/** 绑定未就绪时的重试节奏（100ms × 50 = 最多等 5s）。 */
const INSTALL_RETRY_INTERVAL_MS = 100;
const INSTALL_MAX_RETRIES = 50;

/** 计量开关：`1` 开启，其余视为关闭。 */
export const IPC_METER_ENABLED_KEY = 'gonavi.perf.ipcMeter.enabled';
/** 开关值的缓存时长：避免每次绑定调用都读一次 localStorage。 */
const ENABLED_CACHE_TTL_MS = 1000;

/** 定时聚合事件名：供性能诊断面板消费。 */
export const IPC_SUMMARY_EVENT = 'gonavi:ipc-summary';

export interface IpcMethodStat {
  name: string;
  calls: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  /** 入参近似字节数累计 */
  reqBytes: number;
  /** 返回值近似字节数累计（Promise 在 resolve 之后才计入） */
  resBytes: number;
  errors: number;
}

export interface IpcMeterSnapshot {
  generatedAt: number;
  totals: {
    calls: number;
    totalMs: number;
    resBytes: number;
    reqBytes: number;
    errors: number;
  };
  /** 按累计耗时降序的前 10 个方法。 */
  topByMs: IpcMethodStat[];
  /** 按响应字节降序的前 10 个方法。 */
  topByBytes: IpcMethodStat[];
}

// ---------------------------------------------------------------- 字节估算

/**
 * 数组近似字节数。小数组走精确 JSON 长度；大数组均匀抽样后按长度外推。
 * 抽样步长按 `length / 32` 取整，配合 `sampled < 32` 上界，保证任意长度都只估算 ≤32 项。
 */
function approxArrayBytes(arr: unknown[]): number {
  if (arr.length <= APPROX_BYTES_ARRAY_SAMPLE_LIMIT) {
    try {
      return JSON.stringify(arr)?.length ?? 0;
    } catch {
      return 0;
    }
  }
  const step = Math.max(1, Math.floor(arr.length / APPROX_BYTES_SAMPLE_COUNT));
  let sampled = 0;
  let sampledBytes = 0;
  for (let i = 0; i < arr.length && sampled < APPROX_BYTES_SAMPLE_COUNT; i += step) {
    sampled += 1;
    sampledBytes += approxBytes(arr[i]) + 1;
  }
  if (sampled === 0) {
    return 2;
  }
  return Math.ceil((sampledBytes / sampled) * arr.length) + 2;
}

/**
 * 载荷近似字节数。绝不因计量而抛异常或引入长耗时：
 * - 字符串（含 gzip+base64 大载荷）直接取长度，避免 stringify 再拷贝一份；
 * - 对象含大数组属性（典型如 QueryResult.data）时逐属性估算，避免整体序列化。
 */
export function approxBytes(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === 'string') {
    return value.length + 2;
  }
  if (Array.isArray(value)) {
    return approxArrayBytes(value);
  }
  if (typeof value === 'object') {
    try {
      const entries = Object.entries(value as Record<string, unknown>);
      const hasLargeArray = entries.some(
        ([, item]) => Array.isArray(item) && item.length > APPROX_BYTES_ARRAY_SAMPLE_LIMIT,
      );
      if (hasLargeArray) {
        let total = 2;
        for (const [key, item] of entries) {
          total += key.length + 3 + approxBytes(item);
        }
        return total;
      }
      return JSON.stringify(value)?.length ?? 0;
    } catch {
      return 0;
    }
  }
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- 开关

let cachedEnabled: boolean | null = null;
let cachedEnabledAt = 0;

/**
 * 计量是否开启。1s 内复用缓存，避免每次绑定调用都访问 localStorage；
 * 因此从设置界面写入开关后最多 1s 生效——对诊断设施而言足够即时。
 */
export function isIpcMeterEnabled(): boolean {
  const now = Date.now();
  if (cachedEnabled !== null && now - cachedEnabledAt < ENABLED_CACHE_TTL_MS) {
    return cachedEnabled;
  }
  let enabled = false;
  try {
    enabled = localStorage.getItem(IPC_METER_ENABLED_KEY) === '1';
  } catch {
    // localStorage 不可用（隐私模式）时按关闭处理
    enabled = false;
  }
  cachedEnabled = enabled;
  cachedEnabledAt = now;
  return enabled;
}

/** 设置计量开关；同时刷新缓存，避免调用方还要等 TTL 过期。 */
export function setIpcMeterEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  cachedEnabledAt = Date.now();
  try {
    if (enabled) {
      localStorage.setItem(IPC_METER_ENABLED_KEY, '1');
    } else {
      localStorage.removeItem(IPC_METER_ENABLED_KEY);
    }
  } catch {
    // 落盘失败不影响本次会话内的开关状态
  }
}

// ---------------------------------------------------------------- 统计与包装

const stats = new Map<string, IpcMethodStat>();
/**
 * 包装函数缓存：按属性名缓存，保证对同一方法的重复读取返回**稳定引用**。
 * 若不缓存，每次 `App.Foo` 读取都会生成新闭包，既增加 GC 压力，也会让
 * 「提前取出方法引用再调用」的调用方拿到与后续读取不同的函数。
 *
 * 注意：resetIpcStats 刻意**不清空**本缓存，否则已经持有引用的调用方会指向旧包装，
 * 与新读取的包装不一致。统计清零与包装识别是两件事。
 */
const wrapCache = new Map<string | symbol, (...args: any[]) => any>();
/** 被包装的原对象，用于测试还原与 `apply` 时的 this 绑定。 */
let wrappedTarget: object | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;

function getOrInit(name: string): IpcMethodStat {
  let stat = stats.get(name);
  if (!stat) {
    stat = {
      name,
      calls: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      reqBytes: 0,
      resBytes: 0,
      errors: 0,
    };
    stats.set(name, stat);
  }
  return stat;
}

function recordEnd(stat: IpcMethodStat, start: number, result: unknown, error: unknown): void {
  const elapsedMs = performance.now() - start;
  stat.calls += 1;
  stat.totalMs += elapsedMs;
  if (elapsedMs > stat.maxMs) stat.maxMs = elapsedMs;
  stat.lastMs = elapsedMs;
  if (error) {
    stat.errors += 1;
  } else {
    stat.resBytes += approxBytes(result);
  }
}

/**
 * 生成包装函数。关闭时只做一次开关判断就原样转发（不开销统计）；
 * 关闭态下 `this` 与原方法一致（用被包装对象作 this），保证调用语义完全不变。
 */
function makeWrapped(orig: (...args: any[]) => any, prop: string, target: any): (...args: any[]) => any {
  return function wrapped(this: any, ...args: any[]) {
    if (!isIpcMeterEnabled()) {
      return orig.apply(target, args);
    }
    const stat = getOrInit(prop);
    const start = performance.now();
    stat.reqBytes += approxBytes(args);
    let result: any;
    try {
      result = orig.apply(target, args);
    } catch (err) {
      recordEnd(stat, start, null, err);
      throw err;
    }
    if (result && typeof (result as any).then === 'function') {
      return (result as Promise<unknown>).then(
        (resolved: unknown) => {
          recordEnd(stat, start, resolved, null);
          return resolved;
        },
        (rejected: unknown) => {
          recordEnd(stat, start, null, rejected);
          throw rejected;
        },
      );
    }
    recordEnd(stat, start, result, null);
    return result;
  };
}

function isMeterProxy(value: unknown): boolean {
  return Boolean((value as any)?.__gonaviIpcMeterProxied);
}

// ---------------------------------------------------------------- 安装

function clearRetryTimer(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * 安装 IPC 计量 Proxy。幂等：重复调用安全。
 *
 * 绑定未就绪时只安排重试，**不创建** `window.go` / `window.go.app` 命名空间：
 * 这些对象由 wails 运行时或 dev mock 拥有，提前凭空创建会让「就绪检测」永远为真，
 * 后续真正的绑定注入反而落到我们造出来的空壳上。
 */
export function installIpcMeter(): boolean {
  const w = typeof window !== 'undefined' ? (window as any) : undefined;
  if (!w || !w.go || !w.go.app) {
    scheduleInstallRetry();
    return false;
  }
  const appNs = w.go.app;
  const realApp = appNs.App;
  if (!realApp || typeof realApp !== 'object') {
    scheduleInstallRetry();
    return false;
  }
  if (isMeterProxy(realApp)) {
    clearRetryTimer();
    return true;
  }

  const proxy = new Proxy(realApp, {
    get(t: any, prop: string | symbol, receiver: any) {
      const orig = Reflect.get(t, prop, receiver);
      if (typeof orig !== 'function') {
        return orig;
      }
      let wrapped = wrapCache.get(prop);
      if (!wrapped) {
        wrapped = makeWrapped(orig as (...a: any[]) => any, prop as string, t);
        wrapCache.set(prop, wrapped);
      }
      return wrapped;
    },
  });
  (proxy as any).__gonaviIpcMeterProxied = true;
  wrappedTarget = realApp;
  appNs.App = proxy;
  clearRetryTimer();
  // 安装即暴露控制台入口，让 main.tsx 只需要一行安装调用。
  exposeIpcMeterDebug();
  return true;
}

function scheduleInstallRetry(): void {
  if (typeof window === 'undefined' || retryTimer !== null) {
    return;
  }
  if (retryCount >= INSTALL_MAX_RETRIES) {
    return;
  }
  retryCount += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    installIpcMeter();
  }, INSTALL_RETRY_INTERVAL_MS);
}

/** 停止待执行的重试（测试清理用，避免定时器跨用例泄漏）。 */
export function stopIpcMeterRetry(): void {
  clearRetryTimer();
  retryCount = 0;
}

/** 是否已成功挂载计量 Proxy（仅用于诊断）。 */
export function isIpcMeterInstalled(): boolean {
  const w = typeof window !== 'undefined' ? (window as any) : undefined;
  return isMeterProxy(w?.go?.app?.App);
}

// ---------------------------------------------------------------- 聚合与导出

export function getIpcStats(): IpcMethodStat[] {
  return Array.from(stats.values()).map((stat) => ({ ...stat }));
}

/** 清零统计。不清空包装缓存（见 wrapCache 注释）。 */
export function resetIpcStats(): void {
  stats.clear();
}

/** 生成聚合快照：同时给出「按耗时」与「按字节」两个热点榜，便于快速定位 IPC 瓶颈。 */
export function getIpcStatsSummary(): IpcMeterSnapshot {
  const all = getIpcStats();
  const totals = all.reduce(
    (acc, stat) => {
      acc.calls += stat.calls;
      acc.totalMs += stat.totalMs;
      acc.resBytes += stat.resBytes;
      acc.reqBytes += stat.reqBytes;
      acc.errors += stat.errors;
      return acc;
    },
    { calls: 0, totalMs: 0, resBytes: 0, reqBytes: 0, errors: 0 },
  );
  return {
    generatedAt: Date.now(),
    totals,
    topByMs: [...all].sort((a, b) => b.totalMs - a.totalMs).slice(0, 10),
    topByBytes: [...all].sort((a, b) => b.resBytes - a.resBytes).slice(0, 10),
  };
}

/** 导出为 JSON 字符串，供诊断面板或控制台落盘分析。 */
export function exportIpcStats(): string {
  return JSON.stringify(getIpcStatsSummary(), null, 2);
}

/** 控制台调试入口：window.__gonaviIpcMeter */
export function exposeIpcMeterDebug(): void {
  const w = typeof window !== 'undefined' ? (window as any) : undefined;
  if (!w) return;
  w.__gonaviIpcMeter = {
    install: installIpcMeter,
    isInstalled: isIpcMeterInstalled,
    isEnabled: isIpcMeterEnabled,
    setEnabled: setIpcMeterEnabled,
    getStats: getIpcStats,
    getSummary: getIpcStatsSummary,
    reset: resetIpcStats,
    export: exportIpcStats,
    startAutoSummary: startIpcMeterAutoSummary,
  };
}

/**
 * 启动定时聚合：仅当间隔内确有新调用时才派发 `gonavi:ipc-summary`，
 * 并把最新快照挂到 `window.__gonaviIpcMeterLastSummary`，避免空转刷屏。
 * 刻意**不默认启动**：没有消费方时它只是白白占用定时器，故由诊断面板按需调用。
 * 返回停止函数。
 */
export function startIpcMeterAutoSummary(intervalMs = 5000): () => void {
  let lastCalls = -1;
  const handle = setInterval(() => {
    if (!isIpcMeterEnabled()) return;
    const summary = getIpcStatsSummary();
    if (summary.totals.calls === lastCalls) return;
    lastCalls = summary.totals.calls;
    const w = typeof window !== 'undefined' ? (window as any) : undefined;
    if (!w) return;
    w.__gonaviIpcMeterLastSummary = summary;
    if (typeof w.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      try {
        w.dispatchEvent(new CustomEvent(IPC_SUMMARY_EVENT, { detail: summary }));
      } catch {
        // 派发失败不影响计量
      }
    }
  }, intervalMs);
  return () => clearInterval(handle);
}

/**
 * 测试专用：还原被包装对象、清空统计与缓存、停掉重试定时器。
 * 生产代码不要调用——会把计量层拆掉，且已取出的包装引用会与新装的不一致。
 */
export function resetIpcMeterForTests(): void {
  stopIpcMeterRetry();
  stats.clear();
  wrapCache.clear();
  const w = typeof window !== 'undefined' ? (window as any) : undefined;
  if (wrappedTarget && w?.go?.app && isMeterProxy(w.go.app.App)) {
    w.go.app.App = wrappedTarget;
  }
  wrappedTarget = null;
  cachedEnabled = null;
  cachedEnabledAt = 0;
}
