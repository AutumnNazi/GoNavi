import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  filterAISlashCommands,
  getFeaturedAISlashCommands,
  groupAISlashCommands,
} from './aiSlashCommands';

const source = readFileSync(new URL('./aiSlashCommands.ts', import.meta.url), 'utf8');
const zhCnCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/zh-CN.json', import.meta.url), 'utf8'));
const zhTwCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/zh-TW.json', import.meta.url), 'utf8'));
const enUsCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/en-US.json', import.meta.url), 'utf8'));
const jaJpCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/ja-JP.json', import.meta.url), 'utf8'));
const deDeCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/de-DE.json', import.meta.url), 'utf8'));
const ruRuCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/ru-RU.json', import.meta.url), 'utf8'));

const zhCnTranslate = (key: string) => zhCnCatalog[key] || key;

const diagnosticSlashCommandIds = [
  'health',
  'tools',
  'budget',
  'hotspots',
  'mcp',
  'mcpfail',
  'mcpadd',
  'mcpdraft',
  'mcptool',
  'connfail',
  'shortcuts',
  'applog',
  'airender',
  'safety',
  'activity',
  'tx',
] as const;

describe('aiSlashCommands', () => {
  it('uses i18n keys and english fallback instead of legacy Chinese slash metadata literals', () => {
    expect(source).toContain("catalogTranslate('en-US', key, params)");
    expect(source).toContain('ai_chat.input.slash.category.generate.title');
    expect(source).toContain('ai_chat.input.slash.health.label');
    expect(source).toContain('ai_chat.input.slash.tx.prompt');
    expect(source).not.toContain("title: 'SQL 生成'");
    expect(source).not.toContain("description: '直接产出 SQL、测试数据或迁移草稿。'");
    expect(source).not.toContain("label: '🩺 AI 配置体检'");
    expect(source).not.toContain("prompt: '请先调用 inspect_ai_setup_health");
  });

  it('keeps slash keywords behind localized catalog keys instead of production Chinese literals', () => {
    expect(source).toContain('keywordKey:');
    expect(source).not.toContain("keywords: ['查询'");
    expect(source).not.toContain("'工具目录'");
    expect(source).not.toContain("'自动提交'");
  });

  it('keeps slash category, empty-state, command, and keyword keys present in all six catalogs', () => {
    const slashCommandIds = [
      'query',
      'sql',
      'mock',
      'diff',
      'explain',
      'optimize',
      'schema',
      'index',
      ...diagnosticSlashCommandIds,
    ] as const;
    const requiredKeys = [
      'ai_chat.input.slash.category.generate.title',
      'ai_chat.input.slash.category.generate.description',
      'ai_chat.input.slash.category.review.title',
      'ai_chat.input.slash.category.review.description',
      'ai_chat.input.slash.category.diagnose.title',
      'ai_chat.input.slash.category.diagnose.description',
      'ai_chat.input.slash.empty.title',
      'ai_chat.input.slash.empty.description',
      'ai_chat.input.slash.empty.summary',
      ...slashCommandIds.flatMap((id) => ([
        `ai_chat.input.slash.${id}.label`,
        `ai_chat.input.slash.${id}.desc`,
        `ai_chat.input.slash.${id}.prompt`,
        `ai_chat.input.slash.${id}.keywords`,
      ])),
    ];

    for (const key of requiredKeys) {
      expect(zhCnCatalog[key]).toBeTruthy();
      expect(zhTwCatalog[key]).toBeTruthy();
      expect(enUsCatalog[key]).toBeTruthy();
      expect(jaJpCatalog[key]).toBeTruthy();
      expect(deDeCatalog[key]).toBeTruthy();
      expect(ruRuCatalog[key]).toBeTruthy();
    }
  });

  it('returns all default commands when only slash is present', () => {
    const commands = filterAISlashCommands('/');
    const sql = commands.find((command) => command.cmd === '/sql');
    const health = commands.find((command) => command.cmd === '/health');
    const groups = groupAISlashCommands(commands);

    expect(commands.length).toBeGreaterThan(8);
    expect(sql).toMatchObject({
      label: '📝 Generate SQL',
      desc: 'Describe requirements and generate statements',
      prompt: 'Generate SQL from the following requirements:',
    });
    expect(health).toMatchObject({
      label: '🩺 AI health check',
      desc: 'Run health probes for the current AI setup',
      prompt: 'Call inspect_ai_setup_health first. Run a full health check of the current GoNavi AI setup, then summarize blockers, warnings, and nextActions.',
    });
    expect(commands.some((command) => command.cmd === '/health')).toBe(true);
    expect(commands.some((command) => command.cmd === '/tools')).toBe(true);
    expect(commands.some((command) => command.cmd === '/budget')).toBe(true);
    expect(commands.some((command) => command.cmd === '/hotspots')).toBe(true);
    expect(commands.some((command) => command.cmd === '/mcp')).toBe(true);
    expect(commands.some((command) => command.cmd === '/mcpfail')).toBe(true);
    expect(commands.some((command) => command.cmd === '/mcpadd')).toBe(true);
    expect(commands.some((command) => command.cmd === '/mcpdraft')).toBe(true);
    expect(commands.some((command) => command.cmd === '/mcptool')).toBe(true);
    expect(commands.some((command) => command.cmd === '/connfail')).toBe(true);
    expect(commands.some((command) => command.cmd === '/shortcuts')).toBe(true);
    expect(commands.some((command) => command.cmd === '/applog')).toBe(true);
    expect(commands.some((command) => command.cmd === '/airender')).toBe(true);
    expect(commands.some((command) => command.cmd === '/tx')).toBe(true);
    expect(groups[0]).toMatchObject({ key: 'generate', title: 'SQL generation' });
    expect(groups[1]).toMatchObject({ key: 'review', title: 'Structure review' });
    expect(groups[2]).toMatchObject({ key: 'diagnose', title: 'Diagnostic probes' });
  });

  it('supports filtering by chinese keywords in addition to command prefix', () => {
    const commands = filterAISlashCommands('体检', zhCnTranslate);

    expect(commands.map((command) => command.cmd)).toContain('/health');
    expect(commands.map((command) => command.cmd)).not.toContain('/mcpadd');
  });

  it('supports filtering builtin tool catalog diagnostics by keyword and command prefix', () => {
    expect(filterAISlashCommands('工具目录', zhCnTranslate).map((command) => command.cmd)).toContain('/tools');
    expect(filterAISlashCommands('参数提示', zhCnTranslate).map((command) => command.cmd)).toContain('/tools');
    expect(filterAISlashCommands('/too').map((command) => command.cmd)).toContain('/tools');
  });

  it('supports filtering context budget diagnostics by keyword and command prefix', () => {
    expect(filterAISlashCommands('上下文', zhCnTranslate).map((command) => command.cmd)).toContain('/budget');
    expect(filterAISlashCommands('变慢', zhCnTranslate).map((command) => command.cmd)).toContain('/budget');
    expect(filterAISlashCommands('/bud').map((command) => command.cmd)).toContain('/budget');
  });

  it('supports filtering code hotspot diagnostics by keyword and command prefix', () => {
    expect(filterAISlashCommands('大文件', zhCnTranslate).map((command) => command.cmd)).toContain('/hotspots');
    expect(filterAISlashCommands('拆分', zhCnTranslate).map((command) => command.cmd)).toContain('/hotspots');
    expect(filterAISlashCommands('/hot').map((command) => command.cmd)).toContain('/hotspots');
  });

  it('supports filtering shortcut diagnostics by chinese keyword and command prefix', () => {
    expect(filterAISlashCommands('快捷键', zhCnTranslate).map((command) => command.cmd)).toContain('/shortcuts');
    expect(filterAISlashCommands('/sho').map((command) => command.cmd)).toContain('/shortcuts');
  });

  it('supports filtering connection-failure diagnostics by chinese keyword and command prefix', () => {
    expect(filterAISlashCommands('连接失败', zhCnTranslate).map((command) => command.cmd)).toContain('/connfail');
    expect(filterAISlashCommands('/conn').map((command) => command.cmd)).toContain('/connfail');
  });

  it('supports filtering app-log diagnostics by chinese keyword and command prefix', () => {
    expect(filterAISlashCommands('日志', zhCnTranslate).map((command) => command.cmd)).toContain('/applog');
    expect(filterAISlashCommands('/app').map((command) => command.cmd)).toContain('/applog');
  });

  it('supports filtering ai-render diagnostics by chinese keyword and command prefix', () => {
    expect(filterAISlashCommands('气泡空白', zhCnTranslate).map((command) => command.cmd)).toContain('/airender');
    expect(filterAISlashCommands('/air').map((command) => command.cmd)).toContain('/airender');
  });

  it('supports filtering sql editor transaction diagnostics by keyword and command prefix', () => {
    expect(filterAISlashCommands('自动提交', zhCnTranslate).map((command) => command.cmd)).toContain('/tx');
    expect(filterAISlashCommands('未提交', zhCnTranslate).map((command) => command.cmd)).toContain('/tx');
    expect(filterAISlashCommands('/tx').map((command) => command.cmd)).toContain('/tx');
  });

  it('supports filtering mcp tool schema diagnostics by keyword and command prefix', () => {
    expect(filterAISlashCommands('arguments').map((command) => command.cmd)).toContain('/mcptool');
    expect(filterAISlashCommands('MCP工具参数', zhCnTranslate).map((command) => command.cmd)).toContain('/mcptool');
    expect(filterAISlashCommands('/mcpt').map((command) => command.cmd)).toContain('/mcptool');
  });

  it('supports filtering mcp runtime failure diagnostics by keyword and command prefix', () => {
    expect(filterAISlashCommands('运行期失败', zhCnTranslate).map((command) => command.cmd)).toContain('/mcpfail');
    expect(filterAISlashCommands('工具发现0个', zhCnTranslate).map((command) => command.cmd)).toContain('/mcpfail');
    expect(filterAISlashCommands('stdio').map((command) => command.cmd)).toContain('/mcpfail');
    expect(filterAISlashCommands('/mcpf').map((command) => command.cmd)).toContain('/mcpfail');
  });

  it('routes OpenCode questions to the MCP setup command in every catalog', () => {
    const command = filterAISlashCommands('opencode').find((item) => item.cmd === '/mcp');
    expect(command?.prompt).toContain('OpenCode');

    const catalogs = [zhCnCatalog, zhTwCatalog, enUsCatalog, jaJpCatalog, deDeCatalog, ruRuCatalog];
    const namedKeys = [
      'ai_chat.input.slash.mcp.prompt',
      'ai_chat.inspection.setup.next_action.connect_external_client',
      'ai_chat.inspection.setup.warning.external_client_not_connected',
      'ai_chat.inspection.tool_info.inspect_mcp_setup.detail',
      'ai_chat.system.inspection_guidance.inspect_mcp_setup',
      'ai_settings.mcp_server.remote_quick_start.guide.boundary.local_stdio',
    ];
    for (const catalog of catalogs) {
      expect(String(catalog['ai_chat.input.slash.mcp.keywords']).toLowerCase()).toContain('opencode');
      for (const key of namedKeys) {
        expect(catalog[key]).toContain('OpenCode');
      }
    }
  });

  it('supports filtering mcp draft validation diagnostics by keyword and command prefix', () => {
    expect(filterAISlashCommands('MCP草稿', zhCnTranslate).map((command) => command.cmd)).toContain('/mcpdraft');
    expect(filterAISlashCommands('启动命令', zhCnTranslate).map((command) => command.cmd)).toContain('/mcpdraft');
    expect(filterAISlashCommands('/mcpd').map((command) => command.cmd)).toContain('/mcpdraft');
  });

  it('groups commands by configured category order', () => {
    const groups = groupAISlashCommands(filterAISlashCommands('/'));

    expect(groups[0]?.key).toBe('generate');
    expect(groups[1]?.key).toBe('review');
    expect(groups[2]?.key).toBe('diagnose');
  });

  it('keeps featured commands available for empty-state quick picks', () => {
    const featured = getFeaturedAISlashCommands().map((command) => command.cmd);

    expect(featured).toContain('/sql');
    expect(featured).toContain('/health');
    expect(featured).toContain('/mcp');
    expect(featured).toContain('/mcpadd');
    expect(featured).toContain('/connfail');
    expect(featured).toContain('/tx');
    expect(featured).not.toContain('/tools');
    expect(featured).not.toContain('/budget');
    expect(featured).not.toContain('/mcpfail');
    expect(featured).not.toContain('/shortcuts');
  });
});
