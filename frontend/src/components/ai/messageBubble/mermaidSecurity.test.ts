// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MERMAID_MAX_SOURCE_LENGTH,
  MERMAID_MAX_SVG_LENGTH,
  MERMAID_RENDER_TIMEOUT_MS,
  assertSafeMermaidSource,
  buildMermaidConfig,
  buildMermaidSandboxDocument,
  enqueueMermaidRender,
  sanitizeMermaidSvg,
  withMermaidRenderTimeout,
} from './mermaidSecurity';

describe('Mermaid security boundary', () => {
  afterEach(() => vi.useRealTimers());

  it('uses strict Mermaid limits that chart directives cannot relax', () => {
    expect(buildMermaidConfig(false)).toMatchObject({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      maxTextSize: MERMAID_MAX_SOURCE_LENGTH,
      maxEdges: 500,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    expect(buildMermaidConfig(true).theme).toBe('dark');
  });

  it.each([
    ['init directive', '%%{init: {"securityLevel":"loose"}}%%\ngraph TD; A-->B'],
    ['prototype key', 'graph TD; __proto__-->A'],
    ['frontmatter config', '---\n  config:\n    securityLevel: loose\n---\ngraph TD; A-->B'],
  ])('rejects unsafe %s before loading Mermaid', (_label, source) => {
    expect(() => assertSafeMermaidSource(source)).toThrow();
  });

  it('rejects oversized diagrams before parsing', () => {
    expect(() => assertSafeMermaidSource('x'.repeat(MERMAID_MAX_SOURCE_LENGTH + 1))).toThrow();
  });

  it('removes executable markup, dangerous URLs, inline CSS, and external paint servers', () => {
    const sanitized = sanitizeMermaidSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <script>alert(1)</script>
        <style>*{background:url(https://attacker.invalid/x)}</style>
        <animate attributeName="opacity" repeatCount="indefinite" />
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>
        <a href="javascript:alert(1)"><text onclick="alert(1)" style="fill:red">click</text></a>
        <image href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;" />
        <rect fill="url(https://attacker.invalid/fill)" />
        <defs><linearGradient id="safe-gradient" /></defs>
        <rect fill="url(#safe-gradient)" />
      </svg>
    `);

    expect(sanitized).not.toMatch(/<animate|<script|<style|foreignObject|onclick|style=|javascript:|data:text\/html|attacker\.invalid/i);
    expect(sanitized).toContain('url(#safe-gradient)');
  });

  it('rejects oversized renderer output', () => {
    expect(() => sanitizeMermaidSvg(`<svg>${'x'.repeat(MERMAID_MAX_SVG_LENGTH)}</svg>`)).toThrow();
  });

  it('wraps sanitized SVG in a scriptless sandbox document', () => {
    const document = buildMermaidSandboxDocument('<svg><text>safe</text></svg>', true);
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("base-uri 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain('color-scheme:dark');
    expect(document).toContain('<svg><text>safe</text></svg>');
    expect(document).not.toContain('<script');
  });

  it('fails one render after the timeout budget', async () => {
    vi.useFakeTimers();
    const result = withMermaidRenderTimeout(new Promise(() => {}));
    const assertion = expect(result).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(MERMAID_RENDER_TIMEOUT_MS);
    await assertion;
  });

  it('continues the serial render queue after one render rejects', async () => {
    const calls: string[] = [];
    const failed = enqueueMermaidRender(async () => {
      calls.push('failed');
      throw new Error('render failed');
    });
    const succeeded = enqueueMermaidRender(async () => {
      calls.push('succeeded');
      return 'diagram';
    });

    await expect(failed).rejects.toThrow('render failed');
    await expect(succeeded).resolves.toBe('diagram');
    expect(calls).toEqual(['failed', 'succeeded']);
  });
});
