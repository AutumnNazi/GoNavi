import { describe, expect, it } from 'vitest';

import { setCurrentLanguage } from '../i18n';
import {
  formatSidebarDriverAgentUpdateWarning,
  formatSidebarRowCount,
} from './Sidebar';

describe('Sidebar v2 metadata', () => {
  it('formats table row counts for sidebar labels', () => {
    expect(formatSidebarRowCount(-1)).toBe('');
    expect(formatSidebarRowCount(0)).toBe('0');
    expect(formatSidebarRowCount(27)).toBe('27');
    expect(formatSidebarRowCount(1532)).toBe('1.5K');
    expect(formatSidebarRowCount(2_450_000)).toBe('2.5M');
  });

  it('falls back to the current language when the backend does not provide an update message', () => {
    setCurrentLanguage('en-US');

    expect(formatSidebarDriverAgentUpdateWarning('PostgreSQL', {})).toBe(
      'PostgreSQL driver agent must be reinstalled to apply driver-side updates for this version',
    );
  });

  it('preserves backend update copy without wrapping it in a localized shell', () => {
    setCurrentLanguage('en-US');

    expect(
      formatSidebarDriverAgentUpdateWarning('ClickHouse', {
        updateReason: 'raw runtime reason: checksum mismatch abc123',
      }),
    ).toBe('raw runtime reason: checksum mismatch abc123');
    expect(
      formatSidebarDriverAgentUpdateWarning('ClickHouse', {
        message: 'ClickHouse 驱动代理需要重装',
      }),
    ).toBe('ClickHouse 驱动代理需要重装');
  });
});
