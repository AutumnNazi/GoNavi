import React from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readV2ThemeCss } from '../test/readV2ThemeCss';

describe('QueryEditorToolbar layout', () => {
  it('keeps the v2 toolbar on a single scrollable row in small windows', () => {
    const toolbarSource = readFileSync(new URL('./QueryEditorToolbar.tsx', import.meta.url), 'utf8');
    const css = readV2ThemeCss();
    const toolbarCss = css.slice(
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar {'),
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-main {'),
    );
    const toolbarMainCss = css.slice(
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-main {'),
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-selects {'),
    );

    expect(toolbarSource).toContain('gn-v2-query-toolbar-main');
    expect(toolbarSource).toContain('gn-v2-query-toolbar-actions');
    expect(css).toContain('body[data-ui-version="v2"] .gn-v2-query-toolbar-main');
    expect(toolbarCss).toContain('overflow-x: auto;');
    expect(toolbarCss).toContain('overflow-y: hidden;');
    expect(toolbarCss).toContain('flex-wrap: nowrap;');
    expect(toolbarMainCss).toContain('flex-wrap: nowrap;');
    expect(toolbarMainCss).toContain('min-width: 100%;');
    expect(toolbarMainCss).toContain('width: max-content;');
    expect(css).toContain('body[data-ui-version="v2"] .gn-v2-query-toolbar-actions {');
    expect(css).toContain('body[data-ui-version="v2"] .gn-v2-query-toolbar-action-pair {');
  });

  it('keeps run and stop buttons separated in the v2 toolbar action group', () => {
    const toolbarSource = readFileSync(new URL('./QueryEditorToolbar.tsx', import.meta.url), 'utf8');
    const css = readV2ThemeCss();

    expect(toolbarSource).toContain('gn-v2-query-toolbar-action-group');
    expect(toolbarSource).not.toContain('Space.Compact');
    expect(css).toContain('body[data-ui-version="v2"] .gn-v2-query-toolbar-action-group {');
    expect(css).not.toContain('.gn-v2-query-toolbar-action-group.ant-btn-group');
    expect(css).toContain('gap: 6px;');
  });

  it('optically centers the word-wrap icon in its v2 icon-only action', () => {
    const toolbarSource = readFileSync(new URL('./QueryEditorToolbar.tsx', import.meta.url), 'utf8');
    const css = readV2ThemeCss();
    const wordWrapCss = css.slice(
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-word-wrap-action.ant-btn,'),
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-action-group {'),
    );

    expect(toolbarSource).toContain('gn-v2-query-toolbar-word-wrap-action');
    expect(toolbarSource).toContain('gn-query-toolbar-word-wrap-icon');
    expect(toolbarSource).toContain('{!isV2Ui && t("query_editor.action.word_wrap")}');
    expect(wordWrapCss).toContain('align-items: center;');
    expect(wordWrapCss).toContain('justify-content: center;');
    expect(wordWrapCss).toContain('width: 16px;');
    expect(wordWrapCss).toContain('height: 16px;');
    expect(wordWrapCss).not.toContain('translateY');
  });

  it('keeps commit button hover styling in source and v2 css', () => {
    const css = readV2ThemeCss();
    const commitBaseCss = css.slice(
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-transaction-commit-button {'),
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-transaction-commit-button:hover,'),
    );
    const commitHoverCss = css.slice(
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-transaction-commit-button:hover,'),
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-transaction-commit-button .gn-v2-toolbar-kbd {'),
    );
    const commitKbdHoverCss = css.slice(
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-transaction-commit-button:hover .gn-v2-toolbar-kbd,'),
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-icon-action.ant-btn,'),
    );

    expect(css).toContain('.gn-v2-query-transaction-commit-button:hover');
    expect(css).toContain('.gn-v2-query-transaction-commit-button:focus-visible');
    expect(commitBaseCss).toContain('background: var(--gn-accent-soft) !important;');
    expect(commitHoverCss).not.toContain('background: var(--gn-accent-soft) !important;');
    expect(commitHoverCss).toContain('box-shadow:');
    expect(commitKbdHoverCss).toContain('background:');
  });

  it('keeps transaction selectors compact after replacing selected labels with icons', () => {
    const css = readV2ThemeCss();
    const transactionModeCss = css.slice(
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-transaction-mode-select {'),
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-transaction-delay-select {'),
    );
    const transactionDelayCss = css.slice(
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-transaction-delay-select {'),
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar .ant-select-selector {'),
    );

    expect(transactionModeCss).toContain('width: 48px !important;');
    expect(transactionModeCss).toContain('flex: 0 0 48px !important;');
    expect(transactionDelayCss).toContain('width: 48px !important;');
    expect(transactionDelayCss).toContain('flex: 0 0 48px !important;');
    expect(css).toContain(
      'body[data-ui-version="v2"] .gn-v2-query-toolbar .gn-v2-query-toolbar-icon-select .ant-select-selector {',
    );
  });

  it('uses a stable icon-button width for every v2 SQL toolbar action', () => {
    const toolbarSource = readFileSync(new URL('./QueryEditorToolbar.tsx', import.meta.url), 'utf8');
    const css = readV2ThemeCss();
    const iconActionCss = css.slice(
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-icon-action.ant-btn,'),
      css.indexOf('body[data-ui-version="v2"] .gn-v2-query-toolbar-run-action.ant-btn {'),
    );

    expect(toolbarSource).toContain('EllipsisOutlined');
    expect(toolbarSource).toContain('gn-v2-query-toolbar-menu-trigger');
    expect(toolbarSource).toContain('aria-haspopup="menu"');
    expect(toolbarSource).toContain('aria-expanded={isV2Ui ? openToolbarMenu === "ai" : undefined}');
    expect(toolbarSource).toContain('aria-expanded={isV2Ui ? openToolbarMenu === "more" : undefined}');
    expect(toolbarSource).toContain('aria-expanded={isV2Ui ? openToolbarMenu === "format" : undefined}');
    expect(iconActionCss).toContain('width: 34px !important;');
    expect(iconActionCss).toContain('min-width: 34px !important;');
    expect(iconActionCss).toContain('padding: 0 !important;');
  });

  it('keeps editor search action grouped with formatting actions', () => {
    const toolbarSource = readFileSync(new URL('./QueryEditorToolbar.tsx', import.meta.url), 'utf8');
    const formatActionPairStart = toolbarSource.indexOf('SearchOutlined');
    const formatActionPairEnd = toolbarSource.indexOf('!isV2Ui && (');
    const formatActionPairSource = toolbarSource.slice(formatActionPairStart, formatActionPairEnd);

    expect(toolbarSource).toContain('SearchOutlined');
    expect(formatActionPairSource).toContain('query_editor.action.find_in_editor');
    expect(formatActionPairSource).toContain('query_editor.action.find_in_editor_with_shortcut');
    expect(formatActionPairSource).toContain('onClick={onFindInEditor}');
    expect(formatActionPairSource).toContain('FormatPainterOutlined');
  });

  it('shows delayed full-name tooltips for truncated connection and database selectors', () => {
    const toolbarSource = readFileSync(new URL('./QueryEditorToolbar.tsx', import.meta.url), 'utf8');
    const css = readV2ThemeCss();
    const connectionSelectSource = toolbarSource.slice(
      toolbarSource.indexOf('gn-v2-query-toolbar-connection-select'),
      toolbarSource.indexOf('gn-v2-query-toolbar-database-select'),
    );
    const databaseSelectSource = toolbarSource.slice(
      toolbarSource.indexOf('gn-v2-query-toolbar-database-select'),
      toolbarSource.indexOf('gn-v2-query-toolbar-max-rows-select'),
    );

    expect(toolbarSource).toContain('FULL_NAME_TOOLTIP_DELAY_SECONDS = 1');
    expect(toolbarSource).toContain('mouseEnterDelay={FULL_NAME_TOOLTIP_DELAY_SECONDS}');
    expect(toolbarSource).toContain('renderFullNameSelectTooltip');
    expect(toolbarSource).toContain('gn-query-toolbar-select-full-name');
    expect(toolbarSource).toContain('title: ""');
    expect(connectionSelectSource).toContain('optionRender={(option) => renderFullNameSelectTooltip(option.data.fullName)}');
    expect(connectionSelectSource).toContain('labelRender={(option) => renderFullNameSelectTooltip(option.label ?? option.value)}');
    expect(databaseSelectSource).toContain('optionRender={(option) => renderFullNameSelectTooltip(option.data.fullName)}');
    expect(databaseSelectSource).toContain('labelRender={(option) => renderFullNameSelectTooltip(option.label ?? option.value)}');
    expect(css).toContain('.gn-query-toolbar-select-full-name {');
    expect(css).toContain('text-overflow: ellipsis;');
    expect(css).toContain('white-space: nowrap;');
  });
});
