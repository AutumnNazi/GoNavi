import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SandboxedHTMLPanel, sandboxedPanelDocument } from './SandboxedHTMLPanel';

describe('sandboxed custom HTML panel', () => {
  it('renders an opaque-origin frame without host navigation or same-origin access', () => {
    const html = renderToStaticMarkup(<SandboxedHTMLPanel title="Dashboard" source="<h1>Hello</h1>" />);
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).not.toContain('allow-top-navigation');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('allow="camera &#x27;none&#x27;');
    expect(html).toContain('clipboard-read &#x27;none&#x27;');
    expect(html).toContain('title="Dashboard"');
  });

  it('blocks network, forms, nested frames and base URL changes in the frame document', () => {
    const document = sandboxedPanelDocument('<h1>Hello</h1><script>document.title = "ready"</script>');
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("frame-src 'none'");
    expect(document).toContain("base-uri 'none'");
    expect(document).toContain("object-src 'none'");
    expect(document).toContain('<h1>Hello</h1><script>document.title = "ready"</script>');
  });
});
