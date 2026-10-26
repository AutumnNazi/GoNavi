import { describe, expect, it } from 'vitest';
import { buildAdvancedMessageQuery, sortPullPreviewRows } from './messageQueueWorkbenchModel';

describe('sortPullPreviewRows', () => {
  it('orders Kafka rows oldest first so follow-latest selects the newest message', () => {
    const rows = [
      { timestamp: '2026-10-21T10:00:03Z', partition: 0, offset: 9 },
      { timestamp: '2026-10-21T10:00:01Z', partition: 1, offset: 4 },
      { timestamp: '2026-10-21T10:00:01Z', partition: 0, offset: 7 },
      { timestamp: '2026-10-21T10:00:02Z', partition: 0, offset: 8 },
    ];
    expect(sortPullPreviewRows('kafka', rows).map((row) => `${row.partition}:${row.offset}`))
      .toEqual(['0:7', '1:4', '0:8', '0:9']);
    expect(rows[0].offset).toBe(9);
  });

  it('keeps other transports in arrival order', () => {
    const rows = [{ queue_offset: 2 }, { queue_offset: 1 }];
    expect(sortPullPreviewRows('rocketmq', rows)).toBe(rows);
  });
});

describe('buildAdvancedMessageQuery', () => {
  it('does not default Kafka to a consumer-group read', () => {
    expect(buildAdvancedMessageQuery('kafka', 'orders.events'))
      .toBe('SELECT * FROM "orders.events" LATEST LIMIT 20;');
    expect(buildAdvancedMessageQuery('rocketmq', 'orders.events'))
      .toBe('CONSUME FROM "orders.events" LIMIT 100;');
  });
});
