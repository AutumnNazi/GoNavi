import { describe, expect, it } from 'vitest';

import viteConfig from '../../../../vite.config';

const codeHighlightDependencies = [
  'react-syntax-highlighter/dist/esm/prism-light',
  'react-syntax-highlighter/dist/esm/languages/prism/bash',
  'react-syntax-highlighter/dist/esm/languages/prism/css',
  'react-syntax-highlighter/dist/esm/languages/prism/diff',
  'react-syntax-highlighter/dist/esm/languages/prism/go',
  'react-syntax-highlighter/dist/esm/languages/prism/ini',
  'react-syntax-highlighter/dist/esm/languages/prism/java',
  'react-syntax-highlighter/dist/esm/languages/prism/javascript',
  'react-syntax-highlighter/dist/esm/languages/prism/json',
  'react-syntax-highlighter/dist/esm/languages/prism/jsx',
  'react-syntax-highlighter/dist/esm/languages/prism/markdown',
  'react-syntax-highlighter/dist/esm/languages/prism/markup',
  'react-syntax-highlighter/dist/esm/languages/prism/php',
  'react-syntax-highlighter/dist/esm/languages/prism/python',
  'react-syntax-highlighter/dist/esm/languages/prism/ruby',
  'react-syntax-highlighter/dist/esm/languages/prism/rust',
  'react-syntax-highlighter/dist/esm/languages/prism/sql',
  'react-syntax-highlighter/dist/esm/languages/prism/toml',
  'react-syntax-highlighter/dist/esm/languages/prism/tsx',
  'react-syntax-highlighter/dist/esm/languages/prism/typescript',
  'react-syntax-highlighter/dist/esm/languages/prism/yaml',
  'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus',
  'react-syntax-highlighter/dist/esm/styles/prism/vs',
];

describe('AI code block Vite dependency boundary', () => {
  it('pre-bundles every static syntax-highlighter dependency', () => {
    const includedDependencies = viteConfig.optimizeDeps?.include || [];
    expect(includedDependencies).toEqual(expect.arrayContaining(codeHighlightDependencies));
  });
});
