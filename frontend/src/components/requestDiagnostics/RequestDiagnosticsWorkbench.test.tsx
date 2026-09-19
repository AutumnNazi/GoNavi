import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n/provider';
import RequestDiagnosticsWorkbench from './RequestDiagnosticsWorkbench';

const tab = {
  id: 'request-diagnostics',
  title: '请求诊断',
  type: 'request-diagnostics' as const,
  connectionId: '',
};

describe('RequestDiagnosticsWorkbench', () => {
  it('renders the privacy boundary and an empty diagnostic panel in Chinese', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider preference="zh-CN" systemLanguages={[]} onPreferenceChange={() => {}}>
        <RequestDiagnosticsWorkbench tab={tab} backend={{}} />
      </I18nProvider>,
    );
    expect(markup).toContain('请求诊断');
    expect(markup).toContain('不保存 SQL、结果行、连接地址或凭证');
    expect(markup).toContain('按请求 ID 过滤');
    expect(markup).toContain('生成诊断包');
    expect(markup).toContain('导出前会先展示采集范围和脱敏结果');
    expect(markup).toContain('失败任务最小复现包');
    expect(markup).toContain('查询、同步、导入和 MCP 失败');
    expect(markup).toContain('导入前显示脱敏清单');
    expect(markup).toContain('导入复现包');
    expect(markup).toContain('暂无可导出的失败任务');
    expect(markup).toContain('暂无请求追踪');
  });

  it('renders English chrome when the app language is English', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider preference="en-US" systemLanguages={[]} onPreferenceChange={() => {}}>
        <RequestDiagnosticsWorkbench tab={tab} backend={{}} />
      </I18nProvider>,
    );
    expect(markup).toContain('Request Diagnostics');
    expect(markup).toContain('no SQL, result rows, connection addresses, or credentials');
    expect(markup).toContain('Filter by request ID');
    expect(markup).toContain('Generate diagnostics package');
    expect(markup).toContain('Minimal Reproduction Bundles');
    expect(markup).toContain('Import bundle');
    expect(markup).toContain('No failed tasks available for export');
    expect(markup).toContain('No request traces yet');
    expect(markup).not.toContain('请求诊断');
    expect(markup).not.toContain('生成诊断包');
  });

  it('falls back to the English catalog when no i18n provider is mounted', () => {
    const markup = renderToStaticMarkup(
      <RequestDiagnosticsWorkbench tab={tab} backend={{}} />,
    );
    expect(markup).toContain('Request Diagnostics');
    expect(markup).toContain('Generate diagnostics package');
    expect(markup).not.toContain('请求诊断');
  });
});
