import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { setCurrentLanguage } from '../../i18n';
import NacosServiceRowStatus, {
  buildNacosServiceStatisticsIndex,
  type NacosServiceStatisticsPage,
} from './NacosServiceRowStatus';

const renderStatus = (
  rawName: string,
  summary: Record<string, unknown> | undefined,
): string => renderToStaticMarkup(
  <NacosServiceRowStatus rawName={rawName} summary={summary} />,
);

describe('buildNacosServiceStatisticsIndex', () => {
  beforeEach(() => {
    setCurrentLanguage('en-US');
  });

  it('以 GROUP@@service 为键建立索引', () => {
    const index = buildNacosServiceStatisticsIndex({
      statisticsAvailable: true,
      services: [
        { name: 'order-api', groupName: 'ORDER_GROUP', instanceCount: 3, healthyInstanceCount: 2 },
        { name: 'pay-api', groupName: 'PAY_GROUP', instanceCount: 1, healthyInstanceCount: 1 },
      ],
    });

    expect(index.size).toBe(2);
    expect(index.get('ORDER_GROUP@@order-api')?.healthyInstanceCount).toBe(2);
    expect(index.get('PAY_GROUP@@pay-api')?.instanceCount).toBe(1);
  });

  it('groupName 缺失时归入 DEFAULT_GROUP，与后端口径一致', () => {
    const index = buildNacosServiceStatisticsIndex({
      statisticsAvailable: true,
      services: [{ name: 'legacy-api', instanceCount: 1, healthyInstanceCount: 0 }],
    });

    expect(index.has('DEFAULT_GROUP@@legacy-api')).toBe(true);
  });

  it('丢弃没有服务名的条目，避免键退化成 @@ 造成串行', () => {
    const index = buildNacosServiceStatisticsIndex({
      statisticsAvailable: true,
      services: [
        { name: '   ', groupName: 'G' },
        { name: 'ok-api', groupName: 'G', instanceCount: 1, healthyInstanceCount: 1 },
      ],
    });

    expect(index.size).toBe(1);
    expect(index.has('G@@ok-api')).toBe(true);
  });

  it('services 缺失或非法输入时返回空索引而非抛错', () => {
    expect(buildNacosServiceStatisticsIndex(null).size).toBe(0);
    expect(buildNacosServiceStatisticsIndex(undefined).size).toBe(0);
    expect(buildNacosServiceStatisticsIndex({}).size).toBe(0);
    expect(
      buildNacosServiceStatisticsIndex(
        { services: 'not-an-array' } as unknown as NacosServiceStatisticsPage,
      ).size,
    ).toBe(0);
  });
});

describe('NacosServiceRowStatus', () => {
  beforeEach(() => {
    setCurrentLanguage('en-US');
  });

  const summary = (over: Record<string, unknown> = {}) => ({
    name: 'order-api',
    groupName: 'ORDER_GROUP',
    instanceCount: 4,
    healthyInstanceCount: 4,
    statisticsAvailable: true,
    ...over,
  });

  it('全部健康渲染 is-ok 与 健康/总数', () => {
    const markup = renderStatus('ORDER_GROUP@@order-api', summary());

    expect(markup).toContain('gn-nacos-service-row-status is-ok');
    expect(markup).toContain('data-nacos-service-health="ok"');
    expect(markup).toContain('4/4');
  });

  it('部分健康渲染 is-partial', () => {
    const markup = renderStatus('ORDER_GROUP@@order-api', summary({ healthyInstanceCount: 1 }));

    expect(markup).toContain('gn-nacos-service-row-status is-partial');
    expect(markup).toContain('1/4');
  });

  it('全部不健康渲染 is-down', () => {
    const markup = renderStatus('ORDER_GROUP@@order-api', summary({ healthyInstanceCount: 0 }));

    expect(markup).toContain('gn-nacos-service-row-status is-down');
  });

  it('零实例渲染 is-unknown，不伪装成故障', () => {
    const markup = renderStatus(
      'ORDER_GROUP@@order-api',
      summary({ instanceCount: 0, healthyInstanceCount: 0 }),
    );

    expect(markup).toContain('gn-nacos-service-row-status is-unknown');
  });

  it('统计不可用时返回 null，而不是渲染成离线', () => {
    expect(renderStatus('ORDER_GROUP@@order-api', summary({ statisticsAvailable: false }))).toBe('');
  });

  it('索引未命中（无 summary）时返回 null', () => {
    expect(renderStatus('ORDER_GROUP@@order-api', undefined)).toBe('');
  });

  it('计数为脏数据时按 0 处理，不产生 NaN 文案', () => {
    const markup = renderStatus(
      'ORDER_GROUP@@order-api',
      summary({ instanceCount: 'oops', healthyInstanceCount: null }),
    );

    expect(markup).not.toContain('NaN');
    expect(markup).toContain('gn-nacos-service-row-status is-unknown');
  });

  it('tooltip 使用解析后的服务名而不是完整 rawName', () => {
    const markup = renderStatus('ORDER_GROUP@@order-api', summary());

    expect(markup).toContain('order-api');
    expect(markup).not.toContain('ORDER_GROUP@@order-api');
  });

  it('服务名缺少 group 前缀时仍能解析并渲染', () => {
    const markup = renderStatus('order-api', summary({ instanceCount: 2, healthyInstanceCount: 2 }));

    expect(markup).toContain('gn-nacos-service-row-status is-ok');
    expect(markup).toContain('2/2');
  });
});
