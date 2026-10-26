import { describe, expect, it } from 'vitest';
import { sandboxedPageDocument } from './pageDocument';

const TOKEN = 'a1b2c3d4e5f60718';

describe('plugin page document', () => {
  it('keeps the panel CSP so a page cannot reach the network, forms or nested frames', () => {
    const document = sandboxedPageDocument('<h1>Hi</h1>', TOKEN);
    for (const directive of [
      "default-src 'none'",
      "connect-src 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ]) {
      expect(document).toContain(directive);
    }
  });

  it('installs window.gonavi bound to this frame token before the page markup runs', () => {
    const document = sandboxedPageDocument('<h1>Hi</h1>', TOKEN);
    const runtimeIndex = document.indexOf('window.gonavi');
    const markupIndex = document.indexOf('<h1>Hi</h1>');
    expect(runtimeIndex).toBeGreaterThan(-1);
    expect(markupIndex).toBeGreaterThan(-1);
    expect(runtimeIndex).toBeLessThan(markupIndex);
    expect(document).toContain('gonavi:page-call');
    expect(document).toContain('gonavi:page-result');
    expect(document).toContain('"' + TOKEN + '"');
    // The token stays in the runtime closure and the inline script removes itself,
    // so page markup cannot read it or carry it across a navigation.
    expect(document).toContain('document.currentScript.parentNode.removeChild');
    expect(document).toContain('parent.postMessage.bind(parent)');
    expect(document).toContain('event.source !== parent');
  });

  it('passes the page source through unchanged', () => {
    const source = '<section data-page="dashboard">ready</section>';
    expect(sandboxedPageDocument(source, TOKEN)).toContain(source);
  });
});
