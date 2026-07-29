import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AIMessageCodeBlock.tsx', import.meta.url), 'utf8');
const viteConfigSource = readFileSync(new URL('../../../../vite.config.ts', import.meta.url), 'utf8');

describe('AIMessageCodeBlock dependency boundary', () => {
  it('does not pull the complete syntax-highlighter language registry into the AI panel chunk', () => {
    expect(source).not.toMatch(/from\s+['"]react-syntax-highlighter['"]/);
    expect(source).toMatch(/react-syntax-highlighter\/dist\/esm\/prism-light/);
  });

  it('loads Mermaid only when a Mermaid fenced block is rendered', () => {
    expect(source).not.toMatch(/^import\s+mermaid\s+from\s+['"]mermaid['"];?$/m);
    expect(source).toMatch(/await\s+import\(['"]mermaid['"]\)/);
  });

  it('pre-bundles every static syntax-highlighter entry before Wails opens the panel', () => {
    const syntaxHighlighterImports = Array.from(source.matchAll(
      /from\s+['"](react-syntax-highlighter\/dist\/esm\/[^'"]+)['"]/g,
    )).map((match) => match[1]);

    for (const dependency of syntaxHighlighterImports) {
      expect(viteConfigSource).toContain(`'${dependency}'`);
    }
  });
});
