import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('index.html boot splash', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('paints a boot splash outside #root so Windows never presents an empty white WebView', () => {
    expect(html).toContain('id="gonavi-boot-splash"');
    expect(html).toContain('id="root"');
    expect(html).toContain('data-boot-message');
    expect(html).toContain('data-gonavi-windows');
  });
});
