import { describe, expect, it } from 'vitest';

import { parseNacosServiceName } from '../nacosServiceName';
import {
  createNacosServiceScan,
  foldNacosServiceScanPage,
  NACOS_GROUP_HEALTH_DOWN,
  NACOS_GROUP_HEALTH_OK,
  NACOS_GROUP_HEALTH_PARTIAL,
  NACOS_GROUP_HEALTH_UNKNOWN,
  normalizeNacosGroupName,
  resolveNacosGroupHealthState,
  type NacosServicePageWithStatistics,
} from './nacosServiceGroupSummary';

const fold = (pages: NacosServicePageWithStatistics[]) =>
  pages.reduce(
    (scan, page) => foldNacosServiceScanPage(scan, page, parseNacosServiceName),
    createNacosServiceScan(),
  );

const name = (service: string, group = 'G1') => `${group}@@${service}`;

describe('nacosServiceGroupSummary / 服务计数', () => {
  it('按 group 统计服务数，且不依赖任何统计字段', () => {
    const scan = fold([
      { count: 3, serviceNames: [name('a'), name('b'), name('c', 'G2')] },
    ]);

    expect(scan.serviceCounts.get('G1')).toBe(2);
    expect(scan.serviceCounts.get('G2')).toBe(1);
    expect(scan.statisticsAvailable).toBe(false);
  });

  it('跨页累加同一分组的服务数', () => {
    const scan = fold([
      { count: 2, serviceNames: [name('a')] },
      { count: 2, serviceNames: [name('b')] },
    ]);

    expect(scan.serviceCounts.get('G1')).toBe(2);
  });

  it('无 @@ 分隔符的服务名归入 DEFAULT_GROUP', () => {
    const scan = fold([{ count: 1, serviceNames: ['bare-service'] }]);

    expect(scan.serviceCounts.get('DEFAULT_GROUP')).toBe(1);
  });

  it('忽略空白服务名', () => {
    const scan = fold([{ count: 2, serviceNames: ['', '   ', name('a')] }]);

    expect(scan.serviceCounts.get('G1')).toBe(1);
  });

  it('容忍脏数据：services 非数组时不抛错', () => {
    const dirty = { count: 1, serviceNames: [name('a')], services: 'nope' } as unknown as NacosServicePageWithStatistics;
    const scan = fold([dirty]);

    expect(scan.serviceCounts.get('G1')).toBe(1);
    expect(scan.groupHealth.size).toBe(0);
  });
});

describe('nacosServiceGroupSummary / 健康聚合', () => {
  it('汇总同一分组的实例数与健康实例数', () => {
    const scan = fold([
      {
        count: 2,
        serviceNames: [name('a'), name('b')],
        statisticsAvailable: true,
        statisticsFamily: 'v1',
        services: [
          { name: 'a', groupName: 'G1', instanceCount: 2, healthyInstanceCount: 2, statisticsAvailable: true },
          { name: 'b', groupName: 'G1', instanceCount: 3, healthyInstanceCount: 1, statisticsAvailable: true },
        ],
      },
    ]);

    const entry = scan.groupHealth.get('G1');
    expect(entry).toMatchObject({
      groupName: 'G1',
      serviceCount: 2,
      instanceCount: 5,
      healthyInstanceCount: 3,
      statisticsAvailable: true,
    });
    expect(scan.statisticsAvailable).toBe(true);
    expect(scan.statisticsFamily).toBe('v1');
  });

  it('statisticsFamily 取首个上报统计的页，后续页不覆盖', () => {
    // 诊断字段记录的是「统计来自哪一族 API」，扫描中途换族（例如连接重连到
    // 另一个 Nacos 版本）不应改写首个结论，否则日志会指向错误的来源。
    const scan = fold([
      {
        count: 1,
        serviceNames: [name('a')],
        statisticsAvailable: true,
        statisticsFamily: 'v1',
        services: [{ name: 'a', groupName: 'G1', instanceCount: 1, healthyInstanceCount: 1, statisticsAvailable: true }],
      },
      {
        count: 1,
        serviceNames: [name('b')],
        statisticsAvailable: true,
        statisticsFamily: 'v3',
        services: [{ name: 'b', groupName: 'G1', instanceCount: 1, healthyInstanceCount: 1, statisticsAvailable: true }],
      },
    ]);

    expect(scan.statisticsFamily).toBe('v1');
  });

  it('页面标记统计可用但条目未标记时，条目仍计入不可测量', () => {
    // 后端是按「整页」给 availability 的，前端按「逐项」消费。两者不一致时
    // 以逐项为准，避免把没有计数的服务当成 0 实例健康。
    const scan = fold([
      {
        count: 2,
        serviceNames: [name('a'), name('b')],
        statisticsAvailable: true,
        services: [
          { name: 'a', groupName: 'G1', instanceCount: 2, healthyInstanceCount: 2, statisticsAvailable: true },
          { name: 'b', groupName: 'G1', instanceCount: 5, healthyInstanceCount: 5 },
        ],
      },
    ]);

    const entry = scan.groupHealth.get('G1');
    expect(entry?.statisticsAvailable).toBe(false);
    expect(entry?.instanceCount).toBe(2);
    expect(entry?.healthyInstanceCount).toBe(2);
  });

  it('页面未标记统计可用时，条目计数不被采纳', () => {
    const scan = fold([
      {
        count: 1,
        serviceNames: [name('a')],
        statisticsAvailable: false,
        services: [{ name: 'a', groupName: 'G1', instanceCount: 9, healthyInstanceCount: 9, statisticsAvailable: true }],
      },
    ]);

    expect(scan.statisticsAvailable).toBe(false);
    expect(scan.groupHealth.get('G1')?.statisticsAvailable).toBe(true);
  });

  it('同一分组内有任一服务不可测量时，分组总数标记为不可用', () => {
    const scan = fold([
      {
        count: 2,
        serviceNames: [name('a'), name('b')],
        statisticsAvailable: true,
        services: [
          { name: 'a', groupName: 'G1', instanceCount: 2, healthyInstanceCount: 2, statisticsAvailable: true },
          { name: 'b', groupName: 'G1', statisticsAvailable: false },
        ],
      },
    ]);

    const entry = scan.groupHealth.get('G1');
    expect(entry?.statisticsAvailable).toBe(false);
    // 不可测量服务的计数不得被当成 0 累加进总数（否则总数被低估）。
    expect(entry?.instanceCount).toBe(2);
    expect(entry?.healthyInstanceCount).toBe(2);
  });

  it('可测量但零实例的成员单独计数，不从合计里消失', () => {
    const scan = fold([
      {
        count: 2,
        serviceNames: [name('a'), name('b')],
        statisticsAvailable: true,
        services: [
          { name: 'a', groupName: 'G1', instanceCount: 2, healthyInstanceCount: 2, statisticsAvailable: true },
          { name: 'b', groupName: 'G1', instanceCount: 0, healthyInstanceCount: 0, statisticsAvailable: true },
        ],
      },
    ]);

    const entry = scan.groupHealth.get('G1');
    // 合计与健康的 A 服务相同，零实例的 B 在比值里不可见。
    expect(entry?.instanceCount).toBe(2);
    expect(entry?.healthyInstanceCount).toBe(2);
    expect(entry?.serviceWithoutInstanceCount).toBe(1);
    // 因此徽标必须是 partial，不能是「全部健康」。
    expect(resolveNacosGroupHealthState(entry)).toBe(NACOS_GROUP_HEALTH_PARTIAL);
  });

  it('负值与非数字计数归零，不污染聚合', () => {
    const scan = fold([
      {
        count: 1,
        serviceNames: [name('a')],
        statisticsAvailable: true,
        services: [
          { name: 'a', groupName: 'G1', instanceCount: -5, healthyInstanceCount: 'abc', statisticsAvailable: true },
        ],
      },
    ]);

    expect(scan.groupHealth.get('G1')).toMatchObject({ instanceCount: 0, healthyInstanceCount: 0 });
  });

  it('分组成员按首次出现顺序保持稳定', () => {
    const scan = fold([
      {
        count: 2,
        serviceNames: [name('a', 'Z'), name('b', 'A')],
        statisticsAvailable: true,
        services: [
          { name: 'a', groupName: 'Z', instanceCount: 1, healthyInstanceCount: 1, statisticsAvailable: true },
          { name: 'b', groupName: 'A', instanceCount: 1, healthyInstanceCount: 1, statisticsAvailable: true },
        ],
      },
    ]);

    expect(Array.from(scan.groupHealth.keys())).toEqual(['Z', 'A']);
  });
});

describe('nacosServiceGroupSummary / 徽标状态真值表', () => {
  const entry = (over: Partial<Parameters<typeof resolveNacosGroupHealthState>[0]>) => ({
    groupName: 'G1',
    serviceCount: 1,
    instanceCount: 1,
    healthyInstanceCount: 1,
    serviceWithoutInstanceCount: 0,
    statisticsAvailable: true,
    ...over,
  });

  it('全部实例健康 → ok', () => {
    expect(resolveNacosGroupHealthState(entry({ instanceCount: 3, healthyInstanceCount: 3 })))
      .toBe(NACOS_GROUP_HEALTH_OK);
  });

  it('部分实例健康 → partial', () => {
    expect(resolveNacosGroupHealthState(entry({ instanceCount: 3, healthyInstanceCount: 1 })))
      .toBe(NACOS_GROUP_HEALTH_PARTIAL);
  });

  it('有实例但无健康实例 → down', () => {
    expect(resolveNacosGroupHealthState(entry({ instanceCount: 3, healthyInstanceCount: 0 })))
      .toBe(NACOS_GROUP_HEALTH_DOWN);
  });

  it('零实例不计作 down，而是 unknown', () => {
    // 服务存在但无注册实例：说它「离线」会暗示有实例变坏了，属于误导。
    expect(resolveNacosGroupHealthState(entry({ instanceCount: 0, healthyInstanceCount: 0 })))
      .toBe(NACOS_GROUP_HEALTH_UNKNOWN);
  });

  it('统计不可用 → unknown（不得显示为离线）', () => {
    expect(resolveNacosGroupHealthState(entry({ statisticsAvailable: false })))
      .toBe(NACOS_GROUP_HEALTH_UNKNOWN);
  });

  it('缺少条目或服务数为零 → unknown', () => {
    expect(resolveNacosGroupHealthState(null)).toBe(NACOS_GROUP_HEALTH_UNKNOWN);
    expect(resolveNacosGroupHealthState(undefined)).toBe(NACOS_GROUP_HEALTH_UNKNOWN);
    expect(resolveNacosGroupHealthState(entry({ serviceCount: 0 }))).toBe(NACOS_GROUP_HEALTH_UNKNOWN);
  });

  it('组内有零实例服务时不得显示 ok', () => {
    // A(2/2) + B(0/0) 的合计是 2/2，只看比值会得出「全部健康」，
    // 但 B 服务没有任何实例在服务。零实例成员必须把整组拉低为 partial。
    expect(resolveNacosGroupHealthState(entry({
      serviceCount: 2,
      instanceCount: 2,
      healthyInstanceCount: 2,
      serviceWithoutInstanceCount: 1,
    }))).toBe(NACOS_GROUP_HEALTH_PARTIAL);
  });

  it('全部服务都零实例时维持 unknown（不得说成 down）', () => {
    expect(resolveNacosGroupHealthState(entry({
      serviceCount: 2,
      instanceCount: 0,
      healthyInstanceCount: 0,
      serviceWithoutInstanceCount: 2,
    }))).toBe(NACOS_GROUP_HEALTH_UNKNOWN);
  });
});

describe('nacosServiceGroupSummary / 分组名归一', () => {
  it('空白分组名回落 DEFAULT_GROUP', () => {
    expect(normalizeNacosGroupName('')).toBe('DEFAULT_GROUP');
    expect(normalizeNacosGroupName('   ')).toBe('DEFAULT_GROUP');
    expect(normalizeNacosGroupName(undefined)).toBe('DEFAULT_GROUP');
  });

  it('保留真实分组名并去除首尾空白', () => {
    expect(normalizeNacosGroupName('  PAY  ')).toBe('PAY');
  });
});
