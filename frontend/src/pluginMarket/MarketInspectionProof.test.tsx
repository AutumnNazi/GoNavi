import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MarketInspectionQuote } from './types';
vi.mock('../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key, language: 'en-US' }) }));
vi.mock('antd', () => ({ Alert: ({ message }: { message: string }) => <p>{message}</p>,
  Descriptions: ({ items }: { items: { key: string; label: string; children: React.ReactNode }[] }) => <dl>{items.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{item.children}</dd></div>)}</dl> }));
import { MarketInspectionProof } from './MarketInspectionProof';
describe('inspection proof display', () => {
  it('shows real source/digests/expiry but never displays the approval capability', () => {
    const quote: MarketInspectionQuote = { sourceId: 'a'.repeat(64), artifactDigest: 'b'.repeat(64), approvalToken: 'DO-NOT-DISPLAY-CAPABILITY', expiresAt: '2026-10-19T00:00:00Z',
      inspection: { manifest: { schemaVersion: 1, apiVersion: 1, id: 'test.hello', name: 'Hello', version: '1.0.0', permissions: [] }, digest: 'c'.repeat(64), sourcePath: '/staged', sizeBytes: 1 } };
    const html = renderToStaticMarkup(<MarketInspectionProof quote={quote} source="https://market.test" error="" consumed={false} installing={false} />);
    expect(html).toContain('https://market.test'); expect(html).toContain(quote.artifactDigest);
    expect(html).toContain('plugin.market.inspection_expires'); expect(html).not.toContain(quote.approvalToken);
  });
});
