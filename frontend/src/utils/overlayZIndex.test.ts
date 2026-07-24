import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigProvider } from 'antd';
import * as ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  APP_APPLICATION_QUIT_MODAL_Z_INDEX,
  APP_COMMAND_PALETTE_Z_INDEX,
  APP_DETACHED_WINDOW_Z_INDEX_BASE,
  APP_FOREGROUND_MODAL_Z_INDEX,
  APP_NESTED_MODAL_Z_INDEX,
  APP_OVERLAY_Z_INDEX_BASE,
  APP_POPUP_Z_INDEX,
  configureAntdStaticOverlayLayer,
} from './overlayZIndex';

const readSource = (path: string): string => readFileSync(
  fileURLToPath(new globalThis.URL(path, import.meta.url)),
  'utf8',
);

const appSource = readSource('../App.tsx');
const mainSource = readSource('../main.tsx');
const nativeMainSource = readSource('../nativeDetachedMain.tsx');
const nativeAppSource = readSource('../components/NativeDetachedWindowApp.tsx');
const securityProgressSource = readSource('../components/SecurityUpdateProgressModal.tsx');
const exportProgressSource = readSource('../components/ExportProgressModal.tsx');
const connectionModalSource = readSource('../components/ConnectionModal.tsx');
const redisViewerSource = readSource('../components/RedisViewer.tsx');
const resultDiffPanelSource = readSource('../components/resultDiff/ResultDiffPanel.tsx');
const sidebarSearchPanelSource = readSource('../components/sidebar/SidebarSearchPanel.tsx');
const floatingAIChatSource = readSource('../components/FloatingAIChatWindow.tsx');
const floatingWorkbenchSource = readSource('../components/FloatingWorkbenchWindows.tsx');
const floatingQueryResultSource = readSource('../components/FloatingQueryResultWindows.tsx');
const detachedWindowSource = readSource('./detachedWindow.ts');
const legacyGridContextMenuSource = readSource('../components/DataGridLegacyCellContextMenu.tsx');
const dataGridShellSource = readSource('../components/DataGridShell.tsx');
const sidebarSource = readSource('../components/Sidebar.tsx');
const tableOverviewSource = readSource('../components/TableOverview.tsx');
const v2ThemeSource = readSource('../v2-theme.css');

const collectRuntimeSources = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
  const absolutePath = `${directory}/${entry}`;
  if (statSync(absolutePath).isDirectory()) {
    return collectRuntimeSources(absolutePath);
  }
  if (!/\.(?:ts|tsx)$/.test(entry) || /\.(?:test|spec)\.(?:ts|tsx)$/.test(entry)) {
    return [];
  }
  return [absolutePath];
});

const importsRawAntdModal = (source: string, filePath: string): boolean => {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const antdNamespaceAliases = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    if (/^antd\/(?:es|lib)\/modal(?:\/|$)/.test(moduleName)) return true;
    if (moduleName !== 'antd' || !statement.importClause) continue;

    if (statement.importClause.name) {
      antdNamespaceAliases.add(statement.importClause.name.text);
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      antdNamespaceAliases.add(bindings.name.text);
    }
    if (bindings && ts.isNamedImports(bindings)) {
      const importsModal = bindings.elements.some((element) => (
        (element.propertyName || element.name).text === 'Modal'
      ));
      if (importsModal) return true;
    }
  }

  let usesNamespaceModal = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && antdNamespaceAliases.has(node.expression.text)
      && node.name.text === 'Modal'
    ) {
      usesNamespaceModal = true;
      return;
    }
    if (!usesNamespaceModal) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return usesNamespaceModal;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('application overlay z-index policy', () => {
  it('keeps root dialogs, floating windows, popups, and foreground dialogs ordered', () => {
    expect(APP_OVERLAY_Z_INDEX_BASE).toBe(10_000);
    expect(APP_DETACHED_WINDOW_Z_INDEX_BASE).toBeGreaterThan(APP_OVERLAY_Z_INDEX_BASE);
    expect(APP_POPUP_Z_INDEX).toBeGreaterThan(APP_DETACHED_WINDOW_Z_INDEX_BASE);
    expect(APP_FOREGROUND_MODAL_Z_INDEX).toBeGreaterThan(APP_POPUP_Z_INDEX);
    expect(APP_NESTED_MODAL_Z_INDEX).toBeGreaterThan(APP_FOREGROUND_MODAL_Z_INDEX);
    expect(APP_COMMAND_PALETTE_Z_INDEX).toBeGreaterThan(APP_NESTED_MODAL_Z_INDEX);
    expect(APP_APPLICATION_QUIT_MODAL_Z_INDEX).toBeGreaterThan(APP_COMMAND_PALETTE_Z_INDEX);
  });

  it('configures static Ant Design APIs with the same popup base', () => {
    const configSpy = vi.spyOn(ConfigProvider, 'config').mockImplementation(() => undefined);

    configureAntdStaticOverlayLayer();

    expect(configSpy).toHaveBeenCalledWith({
      theme: {
        token: {
          zIndexPopupBase: APP_POPUP_Z_INDEX,
        },
      },
    });
    expect(mainSource).toContain('configureAntdStaticOverlayLayer();');
    expect(nativeMainSource).toContain('configureAntdStaticOverlayLayer();');
  });

  it('uses the shared popup base in both React roots', () => {
    expect(appSource).toContain('zIndexPopupBase: APP_OVERLAY_Z_INDEX_BASE');
    expect(nativeAppSource).toContain('zIndexPopupBase: APP_OVERLAY_Z_INDEX_BASE');
  });

  it('keeps progress dialogs above settings and other root dialogs', () => {
    const settingsModalStart = appSource.indexOf(
      "title={renderUtilityModalTitle(<SettingOutlined />, t('app.settings.title')",
    );
    const settingsModalSource = appSource.slice(settingsModalStart, settingsModalStart + 1_000);
    const downloadProgressStart = appSource.indexOf('title={updateDownloadProgress.version');
    const downloadProgressSource = appSource.slice(downloadProgressStart, downloadProgressStart + 1_200);
    const proxyModalStart = appSource.indexOf(
      "title={renderUtilityModalTitle(<GlobalOutlined />, t('app.proxy.title')",
    );
    const proxyModalSource = appSource.slice(proxyModalStart, proxyModalStart + 800);

    expect(settingsModalSource).toContain('zIndex={settingsCenterModalZIndex}');
    expect(appSource).toContain('const settingsChildModalZIndex = Math.max(');
    expect(downloadProgressSource).toContain('zIndex={settingsChildModalZIndex}');
    expect(proxyModalSource).toContain('zIndex={settingsChildModalZIndex}');
    expect(appSource).toContain('zIndex={settingsChildModalZIndex}');
    expect(securityProgressSource).toContain('zIndex={zIndex}');
    expect(exportProgressSource).toContain('zIndex={APP_NESTED_MODAL_Z_INDEX}');
  });

  it('closes security settings before opening its connection or proxy repair dialog', () => {
    const connectionRepairStart = appSource.indexOf("if (repairEntry.type === 'connection')");
    const proxyRepairStart = appSource.indexOf("if (repairEntry.type === 'proxy')", connectionRepairStart);
    const aiRepairStart = appSource.indexOf("if (repairEntry.type === 'ai')", proxyRepairStart);
    const connectionRepairSource = appSource.slice(connectionRepairStart, proxyRepairStart);
    const proxyRepairSource = appSource.slice(proxyRepairStart, aiRepairStart);

    expect(connectionRepairSource.indexOf('setIsSettingsModalOpen(false);')).toBeGreaterThan(-1);
    expect(connectionRepairSource.indexOf('setIsSettingsModalOpen(false);')).toBeLessThan(
      connectionRepairSource.indexOf('setIsModalOpen(true);'),
    );
    expect(proxyRepairSource.indexOf('setIsSettingsModalOpen(false);')).toBeGreaterThan(-1);
    expect(proxyRepairSource.indexOf('setIsSettingsModalOpen(false);')).toBeLessThan(
      proxyRepairSource.indexOf('setIsProxyModalOpen(true);'),
    );
  });

  it('uses shared foreground and popup layers for remaining custom overlays', () => {
    expect(connectionModalSource).toContain('zIndex={APP_FOREGROUND_MODAL_Z_INDEX}');
    expect(connectionModalSource).toContain('zIndex={APP_NESTED_MODAL_Z_INDEX}');
    expect(redisViewerSource).toContain('zIndex: APP_POPUP_Z_INDEX');
    expect(resultDiffPanelSource).not.toContain('zIndex: 10050');
  });

  it('keeps every in-WebView floating window above root dialogs with usable portaled popups', () => {
    expect(detachedWindowSource).toContain('let max = APP_DETACHED_WINDOW_Z_INDEX_BASE;');
    for (const source of [
      floatingAIChatSource,
      floatingWorkbenchSource,
      floatingQueryResultSource,
    ]) {
      expect(source).toContain("import { createPortal } from 'react-dom';");
      expect(source).toContain('zIndexPopupBase: APP_POPUP_Z_INDEX');
      expect(source).toContain('document.body');
    }
    expect(floatingWorkbenchSource).toContain('z-index: ${APP_DETACHED_WINDOW_Z_INDEX_BASE};');
    expect(floatingQueryResultSource).toContain('z-index: ${APP_DETACHED_WINDOW_Z_INDEX_BASE};');
    expect(resultDiffPanelSource).toContain('z-index: ${APP_DETACHED_WINDOW_Z_INDEX_BASE};');
    expect(resultDiffPanelSource).toContain('zIndexPopupBase: APP_POPUP_Z_INDEX');
  });

  it('routes body-level context menus through the shared popup layer', () => {
    for (const source of [
      legacyGridContextMenuSource,
      dataGridShellSource,
      sidebarSource,
      tableOverviewSource,
    ]) {
      expect(source).toContain('zIndex: APP_POPUP_Z_INDEX');
    }
  });

  it('portals the command palette above modal stacking contexts', () => {
    expect(sidebarSearchPanelSource).toContain("import { createPortal } from 'react-dom';");
    expect(sidebarSearchPanelSource).toContain('style={{ zIndex: APP_COMMAND_PALETTE_Z_INDEX }}');
    expect(sidebarSearchPanelSource).toContain('zIndexPopupBase: APP_COMMAND_PALETTE_Z_INDEX');
    expect(sidebarSearchPanelSource).toContain('document.body');
    expect(v2ThemeSource).not.toMatch(/\.gn-v2-command-backdrop\s*\{[^}]*z-index:/s);
  });

  it('detects raw Ant Design Modal import variants', () => {
    expect(importsRawAntdModal("import { Modal } from 'antd';", 'named.ts')).toBe(true);
    expect(importsRawAntdModal("import * as antd from 'antd'; antd.Modal.confirm({});", 'namespace.ts')).toBe(true);
    expect(importsRawAntdModal("import antd from 'antd'; antd.Modal.confirm({});", 'default.ts')).toBe(true);
    expect(importsRawAntdModal("import Modal from 'antd/es/modal';", 'subpath.ts')).toBe(true);
    expect(importsRawAntdModal("import type { ModalProps } from 'antd';", 'types.ts')).toBe(false);
  });

  it('routes every runtime Modal import through the common wrapper', () => {
    const sourceRoot = fileURLToPath(new globalThis.URL('../', import.meta.url));
    const offenders = collectRuntimeSources(sourceRoot)
      .filter((path) => !path.endsWith('/components/common/ResizableDraggableModal.tsx'))
      .filter((path) => importsRawAntdModal(readFileSync(path, 'utf8'), path))
      .map((path) => path.slice(sourceRoot.length))
      .sort();

    expect(offenders).toEqual([]);
  });
});
