import { describe, expect, it, vi } from 'vitest';

// 模型文件导出 antd 的 Text，这里只测纯函数，避免把整套 antd 拉进单测。
vi.mock('antd', () => ({ Typography: { Text: 'span' } }));

import {
  buildMessageDetailCommand,
  formatByteSize,
  hasMessagePayload,
  messageCardSummary,
} from './messageQueueWorkbenchModel';

describe('message detail on demand', () => {
  it('builds a partition+offset lookup for Kafka', () => {
    expect(buildMessageDetailCommand('kafka', 'orders', { partition: 0, offset: 5 }))
      .toBe('SELECT * FROM "orders" WHERE partition = 0 AND offset = 5 LIMIT 1;');
  });

  it('skips the lookup for other sources or a missing locator', () => {
    expect(buildMessageDetailCommand('rabbitmq', 'orders', { partition: 0, offset: 5 })).toBe('');
    expect(buildMessageDetailCommand('kafka', 'orders', {})).toBe('');
    expect(buildMessageDetailCommand('kafka', '', { partition: 0, offset: 5 })).toBe('');
  });

  it('detects whether a row already carries the payload', () => {
    expect(hasMessagePayload({ value: 'x' })).toBe(true);
    expect(hasMessagePayload({ payload: null })).toBe(true);
    expect(hasMessagePayload({ timestamp: 't', offset: 1 })).toBe(false);
  });
});

describe('message card summary', () => {
  it('prefers the payload preview', () => {
    expect(messageCardSummary({ preview: 'hello', row: {} })).toBe('hello');
  });

  it('falls back to the message key, then to empty', () => {
    expect(messageCardSummary({ preview: '', row: { key: 'k1' } })).toBe('key: k1');
    expect(messageCardSummary({ preview: '', row: {} })).toBe('');
  });
});

describe('byte size formatting', () => {
  it('formats B / KB / MB and rejects invalid values', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(2048)).toBe('2.0 KB');
    expect(formatByteSize(15_505_118)).toBe('14.8 MB');
    expect(formatByteSize(-1)).toBe('');
    expect(formatByteSize('x')).toBe('');
  });
});
