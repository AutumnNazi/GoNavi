/**
 * 低配机运行能力检测（性能专项 C）
 *
 * 目的：在弱 CPU / 无独立显卡 / 小内存（WebView2 单进程）环境下自动识别低配档位，
 * 供 UI 层降级（关闭动画、降低合成负担等），避免在 4 核低压 U + 核显或纯软件合成
 * （无 GPU）的机器上继续承担全量动画与重型特效。
 *
 * 判定信号：
 *   - 逻辑 CPU 核数（navigator.hardwareConcurrency）
 *   - 设备内存（navigator.deviceMemory，非标准，undefined 表示未知）
 *   - WebGL 上下文可用性（无独立 GPU 或驱动被禁用时 getContext('webgl') 常返回 null）
 *
 * 纯函数、零依赖、可单测（浏览器能力通过参数注入，便于在 node/vitest 环境 mock）。
 */

export interface RuntimeCapabilityInfo {
  /** 综合判定是否为低配档位 */
  lowSpec: boolean;
  /** 逻辑 CPU 核数；0 表示未知 */
  cpuCores: number;
  /** 设备内存（MB）；0 表示未知 */
  deviceMemoryMb: number;
  /** WebGL 上下文是否可用 */
  hasWebGL: boolean;
  /** 命中低配的具体原因（供诊断展示） */
  reasons: string[];
}

/** 低配档位阈值：逻辑核 ≤ 4 */
export const LOW_SPEC_CORES = 4;
/** 低配档位阈值：设备内存 ≤ 4GB（0=未知，未知不单独判定） */
export const LOW_SPEC_MEMORY_MB = 4096;

/** 浏览器能力快照：仅测试注入用，运行时一律现读。 */
export type RuntimeCapabilityOverrides = Partial<
  Pick<RuntimeCapabilityInfo, 'cpuCores' | 'deviceMemoryMb' | 'hasWebGL'>
>;

export function readCpuCores(): number {
  const raw = (navigator as Navigator & { hardwareConcurrency?: number })?.hardwareConcurrency;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

export function readDeviceMemoryMb(): number {
  // deviceMemory 单位为 GB（Chrome/Edge 非标准 API）；undefined 归零表示未知。
  const raw = (navigator as Navigator & { deviceMemory?: number })?.deviceMemory;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1024) : 0;
}

/**
 * 探测 WebGL 可用性（不创建持久上下文，调用后立即丢弃）。
 * 非浏览器环境（测试/SSR）默认视为可用，交由 CPU/内存判定，避免把 node 环境误判成低配。
 */
export function probeWebGL(): boolean {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return true;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl') ||
      canvas.getContext('webgl2');
    return Boolean(gl);
  } catch {
    // 某些驱动在 getContext 直接抛异常，等价于「无 WebGL」。
    return false;
  }
}

/**
 * 检测运行时能力并给出低配判定。
 * @param overrides 可选注入（测试用）；传入的字段优先于真实环境。
 */
export function detectRuntimeCapability(
  overrides?: RuntimeCapabilityOverrides,
): RuntimeCapabilityInfo {
  const cpuCores = overrides?.cpuCores !== undefined ? overrides.cpuCores : readCpuCores();
  const deviceMemoryMb =
    overrides?.deviceMemoryMb !== undefined ? overrides.deviceMemoryMb : readDeviceMemoryMb();
  const hasWebGL = overrides?.hasWebGL !== undefined ? overrides.hasWebGL : probeWebGL();

  const weakCpu = cpuCores > 0 && cpuCores <= LOW_SPEC_CORES;
  const weakMem = deviceMemoryMb > 0 && deviceMemoryMb <= LOW_SPEC_MEMORY_MB;

  const reasons: string[] = [];
  if (weakCpu) {
    reasons.push(`cpu<=${LOW_SPEC_CORES}cores`);
  }
  if (weakMem) {
    reasons.push(`mem<=${LOW_SPEC_MEMORY_MB / 1024}GB`);
  }
  if (!hasWebGL) {
    reasons.push('no-webgl');
  }

  // 弱 CPU 且小内存（或内存未知）+ 无 GPU 命中其一即视为低配。
  // 内存未知时不再单独判定：16 核 + 未知内存显然不是低配，误判会导致过度降级。
  const lowSpec = (weakCpu && (weakMem || deviceMemoryMb === 0)) || !hasWebGL;

  return { lowSpec, cpuCores, deviceMemoryMb, hasWebGL, reasons };
}

let cachedCapability: RuntimeCapabilityInfo | null = null;

/** detectRuntimeCapability 的进程内缓存版：WebGL probe 需要创建 canvas，
 *  渲染路径（body class 联动、设置中心开关回显）只应探测一次。 */
export function detectRuntimeCapabilityCached(): RuntimeCapabilityInfo {
  if (!cachedCapability) {
    cachedCapability = detectRuntimeCapability();
  }
  return cachedCapability;
}

/** 清空探测缓存（仅测试用，避免用例间互相污染）。 */
export function resetRuntimeCapabilityCache(): void {
  cachedCapability = null;
}

/**
 * 解析低配档位开关的三态语义：null = 跟随自动检测，true / false = 用户显式固定。
 * 单独抽成纯函数，使 UI（开关回显）与运行时（body class）共用同一判定，不会各算各的。
 */
export function resolveLowSpecModeActive(
  preference: boolean | null | undefined,
  autoDetected: boolean,
): boolean {
  return typeof preference === 'boolean' ? preference : autoDetected;
}

/**
 * 是否应当降低动画：用户显式开启减少动画，或当前处于低配档位。
 *
 * 注意：这里刻意写成「或」再取反，而不是 `!reduceMotion || lowSpecActive`。
 * 后者在低配命中时反而会把 antd 动画打开（true），与降级意图完全相反。
 */
export function shouldReduceMotion(
  reduceMotionPreference: boolean | null | undefined,
  lowSpecActive: boolean,
): boolean {
  return reduceMotionPreference === true || lowSpecActive;
}
