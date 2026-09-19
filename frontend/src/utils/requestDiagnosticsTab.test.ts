import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentLanguage } from '../i18n';
import {
  buildRequestDiagnosticsWorkbenchTab,
  REQUEST_DIAGNOSTICS_WORKBENCH_TAB_ID,
} from './requestDiagnosticsTab';

describe('buildRequestDiagnosticsWorkbenchTab', () => {
  afterEach(() => {
    setCurrentLanguage('zh-CN');
  });

  it('derives the tab title from the active language catalog', () => {
    setCurrentLanguage('en-US');
    expect(buildRequestDiagnosticsWorkbenchTab().title).toBe('Request Diagnostics');
    setCurrentLanguage('zh-CN');
    expect(buildRequestDiagnosticsWorkbenchTab().title).toBe('请求诊断');
  });

  it('keeps a stable workbench tab identity across languages', () => {
    setCurrentLanguage('en-US');
    const tab = buildRequestDiagnosticsWorkbenchTab();
    expect(tab.id).toBe(REQUEST_DIAGNOSTICS_WORKBENCH_TAB_ID);
    expect(tab.type).toBe('request-diagnostics');
    expect(tab.connectionId).toBe('');
  });
});
