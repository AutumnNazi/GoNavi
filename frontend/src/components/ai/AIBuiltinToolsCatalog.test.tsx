import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import AIBuiltinToolsCatalog from './AIBuiltinToolsCatalog';
import { buildOverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import { I18nProvider } from '../../i18n/provider';

const source = readFileSync(new URL('./AIBuiltinToolsCatalog.tsx', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../../App.css', import.meta.url), 'utf8');

const renderCatalog = () => (
  <I18nProvider preference="zh-CN" systemLanguages={['zh-CN']} onPreferenceChange={() => {}}>
    <AIBuiltinToolsCatalog
      darkMode={false}
      overlayTheme={buildOverlayWorkbenchTheme(false)}
      cardBg="#fff"
      cardBorder="rgba(0,0,0,0.08)"
    />
  </I18nProvider>
);

describe('AIBuiltinToolsCatalog', () => {
  it('localizes search and empty chrome copy', () => {
    expect(source).toContain("aria-label={t('ai_settings.tools.search.aria_label')}");
    expect(source).toContain("placeholder={t('ai_settings.tools.search.placeholder')}");
    expect(source).toContain("{t('ai_settings.tools.search.clear')}");
    expect(source).toContain("t('ai_settings.tools.view.flows')");
    expect(source).toContain("t('ai_settings.tools.view.tools')");
    expect(source).toContain("t('ai_settings.tools.empty.no_flow_matches')");
    expect(source).toContain("t('ai_settings.tools.empty.no_matches')");
    expect(source).not.toContain('aria-label="搜索内置工具"');
    expect(source).not.toContain('placeholder="搜索工具、流程或参数，例如 mcp / lineLimit / allowMutating / 事务"');
    expect(source).not.toContain('清除');
    expect(source).not.toContain('当前显示 {visibleFlows.length}/{BUILTIN_TOOL_FLOWS.length} 条推荐流程');
    expect(source).not.toContain('没有匹配的内置工具。可以改搜更宽泛的关键词');
  });

  it('localizes parameter detail labels without translating raw parameter values', () => {
    expect(source).toContain("t('ai_settings.tools.params_label')");
    expect(source).toContain("t('ai_settings.tools.parameters.hint_title')");
    expect(source).toContain("t('ai_settings.tools.parameters.type_label', { type: item.typeLabel })");
    expect(source).toContain("t('ai_settings.tools.parameters.required')");
    expect(source).toContain("t('ai_settings.tools.parameters.optional')");
    expect(source).toContain("t('ai_settings.tools.parameters.enum_values', { values: item.enumValues.join(' / ') })");
    expect(source).toContain("t('ai_settings.tools.parameters.default_value', { value: item.defaultValue })");
    expect(source).toContain("t('ai_settings.tools.parameters.example')");
    expect(source).not.toContain('<span>参数：</span>');
    expect(source).not.toContain('>参数提示<');
    expect(source).not.toContain('类型：{item.typeLabel}');
    expect(source).not.toContain("item.required ? '必填' : '可选'");
    expect(source).not.toContain('可选值：{item.enumValues.join');
    expect(source).not.toContain('默认：{item.defaultValue}');
    expect(source).not.toContain('示例：<code');
  });

  it('localizes the catalog intro copy', () => {
    expect(source).toContain("t('ai_settings.tools.description')");
    expect(source).not.toContain('AI 助手在处理数据库相关问题时，可以自动调用以下内置工具获取真实数据，全程无需人工干预。');
  });

  it('separates recommended flows and built-in tools into dedicated views', () => {
    expect(source).toContain("useState<AIBuiltinToolsCatalogView>('flows')");
    expect(source).toContain('className="gonavi-ai-tool-view-tabs"');
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain("hidden={activeView !== 'flows'}");
    expect(source).toContain("hidden={activeView !== 'tools'}");
    expect(source).toContain('className="gonavi-ai-tool-flow-list"');
    expect(source).toContain('className="gonavi-ai-tool-list"');
    expect(source).toContain('<ApartmentOutlined style={{ color: overlayTheme.iconColor, fontSize: 14 }} aria-hidden="true" />');
    expect(source).toContain('className="gonavi-ai-settings-disclosure gonavi-ai-tool-row"');
    expect(source.split("gridTemplateColumns: '18px minmax(0, 1fr)'")).toHaveLength(3);
    expect(source.split('<ToolOutlined style={{ color: overlayTheme.iconColor, fontSize: 14 }} aria-hidden="true" />')).toHaveLength(2);
    expect(source).not.toContain("gridTemplateColumns: 'minmax(140px, 0.8fr) minmax(0, 1.2fr)'");
    expect(source).not.toContain("textAlign: 'right'");
    expect(source).toContain('gap: 2');
    expect(source).toContain('borderRadius: 4');
    expect(source).not.toContain('borderBottom:');
    expect(source).toContain("background: 'transparent'");
    expect(source).not.toContain("background: cardBg");
    expect(source).not.toContain('borderRadius: 14');
    expect(source).toContain("fontSize: 'var(--gn-settings-font-secondary, 13px)'");
    expect(source).toContain("fontSize: 'var(--gn-font-size-sm, 12px)'");
    expect(source).toContain("fontFamily: 'var(--gn-font-mono)'");
  });

  it('uses native disclosures while keeping flow and tool details mounted', () => {
    const markup = renderToStaticMarkup(renderCatalog());

    expect(markup).toContain('class="gonavi-ai-tool-flow-list"');
    expect(markup).toContain('class="gonavi-ai-tool-view-tabs"');
    expect(markup).toContain('推荐流程');
    expect(markup).toContain('内置工具');
    expect(markup).toContain('<details');
    expect(markup).toContain('<summary');
    expect(markup).toContain('class="gonavi-ai-settings-disclosure gonavi-ai-tool-flow-row"');
    expect(markup).toContain('class="gonavi-ai-settings-disclosure gonavi-ai-tool-row"');
    expect(markup).toContain('gonavi-ai-settings-disclosure-content');
    expect(markup).toContain('gonavi-ai-settings-disclosure-icon');
    expect(appCss).toContain('.gonavi-ai-settings-disclosure > summary::-webkit-details-marker');
    expect(appCss).toContain('.gonavi-ai-settings-disclosure > summary::marker');
    expect(appCss).toContain('.gonavi-ai-settings-disclosure[open] > summary .gonavi-ai-settings-disclosure-icon');
    expect(markup).toContain('正文预览最多返回多少字符');
    expect(source).not.toContain('{tool.icon}');
  });

  it('renders the workspace flows, snapshot tools, and local saved-sql discovery tools', () => {
    const markup = renderToStaticMarkup(renderCatalog());

    expect(markup).toContain('字段反查表');
    expect(markup).toContain('get_all_columns');
    expect(markup).toContain('结构深挖');
    expect(markup).toContain('get_indexes');
    expect(markup).toContain('get_foreign_keys');
    expect(markup).toContain('get_triggers');
    expect(markup).toContain('一键结构快照');
    expect(markup).toContain('inspect_table_bundle');
    expect(markup).toContain('全库快速摸底');
    expect(markup).toContain('inspect_database_bundle');
    expect(markup).toContain('AI 应用健康总览');
    expect(markup).toContain('inspect_app_health');
    expect(markup).toContain('导出 AI 排障支持包');
    expect(markup).toContain('inspect_ai_support_bundle');
    expect(markup).toContain('不含密钥和数据库密码');
    expect(markup).toContain('选择 AI 工具路线');
    expect(markup).toContain('inspect_ai_tool_catalog');
    expect(markup).toContain('每个工具 arguments 怎么填');
    expect(markup).toContain('一键体检 AI 配置');
    expect(markup).toContain('inspect_ai_setup_health');
    expect(markup).toContain('查看 AI 当前能力');
    expect(markup).toContain('inspect_ai_runtime');
    expect(markup).toContain('核对写入安全边界');
    expect(markup).toContain('inspect_ai_safety');
    expect(markup).toContain('排查供应商与模型');
    expect(markup).toContain('inspect_ai_providers');
    expect(markup).toContain('排查聊天发送状态');
    expect(markup).toContain('inspect_ai_chat_readiness');
    expect(markup).toContain('追踪 AI 上游请求');
    expect(markup).toContain('inspect_ai_upstream_logs');
    expect(markup).toContain('请求体预览');
    expect(markup).toContain('排查 MCP 接入状态');
    expect(markup).toContain('inspect_mcp_setup');
    expect(markup).toContain('inspect_mcp_runtime_failures');
    expect(markup).toContain('运行期失败日志');
    expect(markup).toContain('新增 MCP 填写指引');
    expect(markup).toContain('inspect_mcp_authoring_guide');
    expect(markup).toContain('inspect_mcp_draft');
    expect(markup).toContain('真实校验器试算');
    expect(markup).toContain('排查 Docker MCP 启动');
    expect(markup).toContain('inspect_mcp_docker_setup');
    expect(markup).toContain('docker run 参数是否拆对');
    expect(markup).toContain('查看 MCP 工具参数');
    expect(markup).toContain('inspect_mcp_tool_schema');
    expect(markup).toContain('inputSchema');
    expect(markup).toContain('查看当前提示与 Skills');
    expect(markup).toContain('inspect_ai_guidance');
    expect(markup).toContain('查看当前 AI 上下文');
    expect(markup).toContain('inspect_ai_context');
    expect(markup).toContain('查看当前连接');
    expect(markup).toContain('inspect_current_connection');
    expect(markup).toContain('核对数据源能力边界');
    expect(markup).toContain('inspect_connection_capabilities');
    expect(markup).toContain('盘点本地连接资产');
    expect(markup).toContain('inspect_saved_connections');
    expect(markup).toContain('诊断 Redis 单机/哨兵/集群配置');
    expect(markup).toContain('inspect_redis_topology');
    expect(markup).toContain('Sentinel master');
    expect(markup).toContain('盘点外部 SQL 目录');
    expect(markup).toContain('inspect_external_sql_directories');
    expect(markup).toContain('读取外部 SQL 文件');
    expect(markup).toContain('inspect_external_sql_file');
    expect(markup).toContain('读取当前页签');
    expect(markup).toContain('inspect_active_tab');
    expect(markup).toContain('盘点当前工作区');
    expect(markup).toContain('inspect_workspace_tabs');
    expect(markup).toContain('查看当前快捷键配置');
    expect(markup).toContain('inspect_shortcuts');
    expect(markup).toContain('回看最近执行记录');
    expect(markup).toContain('inspect_recent_sql_logs');
    expect(markup).toContain('总结最近 SQL 活动');
    expect(markup).toContain('inspect_recent_sql_activity');
    expect(markup).toContain('核对 SQL 编辑器事务');
    expect(markup).toContain('inspect_sql_editor_transaction');
    expect(markup).toContain('待提交事务');
    expect(markup).toContain('SQL 风险预检');
    expect(markup).toContain('inspect_sql_risk');
    expect(markup).toContain('WHERE 条件');
    expect(markup).toContain('排查应用日志');
    expect(markup).toContain('inspect_app_logs');
    expect(markup).toContain('排查连接失败与冷却');
    expect(markup).toContain('inspect_recent_connection_failures');
    expect(markup).toContain('排查 AI 气泡渲染异常');
    expect(markup).toContain('inspect_ai_last_render_error');
    expect(markup).toContain('诊断 AI 消息流');
    expect(markup).toContain('inspect_ai_message_flow');
    expect(markup).toContain('诊断 AI 上下文体量');
    expect(markup).toContain('inspect_ai_context_budget');
    expect(markup).toContain('messageLimit');
    expect(markup).toContain('治理前端大文件');
    expect(markup).toContain('inspect_codebase_hotspots');
    expect(markup).toContain('前端大文件与拆分热点');
    expect(markup).toContain('复用历史 SQL');
    expect(markup).toContain('inspect_saved_queries');
    expect(markup).toContain('回看 AI 历史对话');
    expect(markup).toContain('inspect_ai_sessions');
    expect(markup).toContain('查找模板片段');
    expect(markup).toContain('inspect_sql_snippets');
    expect(markup).toContain('理解样例数据');
    expect(markup).toContain('preview_table_rows');
    expect(markup).toContain('参数提示');
    expect(markup).toContain('搜索工具、流程或参数');
    expect(markup).toContain('45/45');
    expect(markup).toContain('53/53');
    expect(markup).toContain('类型：string');
    expect(markup).toContain('默认：160');
    expect(markup).toContain('示例：');
    expect(markup).toContain('filePath');
    expect(markup).toContain('正文预览最多返回多少字符');
  });
});
