import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const appCssSource = readFileSync(new URL('./App.css', import.meta.url), 'utf8');

describe('Windows titlebar window controls spacing', () => {
  it('adds a small platform-scoped gap between the custom window buttons', () => {
    expect(appSource).toContain('className="titlebar-window-controls"');
    expect(appSource).toContain("document.body.setAttribute('data-platform', runtimePlatform || '')");
    expect(appCssSource).toMatch(
      /body\[data-platform='windows'\]\s+\.titlebar-window-controls\s*\{[^}]*gap:\s*8px;/s,
    );
  });
});
