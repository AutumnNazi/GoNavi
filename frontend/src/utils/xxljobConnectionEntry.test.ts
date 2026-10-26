import { describe, expect, it } from 'vitest';
import { CONNECTION_TYPE_GROUPS, getConnectionTypeDefaultPort } from './connectionTypeCatalog';
import { resolveConnectionConfigLayout } from './connectionModalPresentation';
import { getUriPlaceholder, getConnectionParamsPlaceholder } from '../components/connectionModal/connectionModalPlaceholders';
import { getDataSourceSpec } from './dataSourceRegistry';

describe('XXL-JOB 连接入口', () => {
  it('在任务调度分组中出现，且排在配置中心之后', () => {
    const groups = CONNECTION_TYPE_GROUPS;
    const labels = groups.map((g) => g.labelKey);
    expect(labels).toContain('connection_modal.step1.group.task_scheduler');
    const schedulerIndex = labels.indexOf('connection_modal.step1.group.task_scheduler');
    const configIndex = labels.indexOf('connection_modal.step1.group.config_center');
    expect(configIndex).toBeGreaterThanOrEqual(0);
    expect(schedulerIndex).toBe(configIndex + 1);
  });

  it('分组内只有 XXL-JOB 一张卡片', () => {
    const group = CONNECTION_TYPE_GROUPS.find((g) => g.labelKey.endsWith('task_scheduler'));
    expect(group?.items.map((i) => i.key)).toEqual(['xxljob']);
    expect(group?.items[0].name).toBe('XXL-JOB');
  });

  it('默认端口为 8080', () => {
    expect(getConnectionTypeDefaultPort('xxljob')).toBe(8080);
  });

  it('描述表声明了专用工作台布局与端口', () => {
    const spec = getDataSourceSpec('xxljob');
    expect(spec?.defaultPort).toBe(8080);
    expect(spec?.ui?.layout).toBe('task_scheduler');
    expect(spec?.protection).toBe(true);
  });

  it('借用 Nacos 的主机端口账号密码表单布局', () => {
    const layout = resolveConnectionConfigLayout('xxljob');
    expect(layout.kind).toBe('nacos');
    expect(layout.sections).toContain('identity');
    expect(layout.sections).toContain('uri');
    expect(layout.sections).toContain('credentials');
  });

  it('提供带 context-path 的示例', () => {
    expect(getUriPlaceholder('xxljob')).toContain('8080');
    expect(getConnectionParamsPlaceholder('xxljob', 'mysql')).toContain('contextPath=');
  });
});
