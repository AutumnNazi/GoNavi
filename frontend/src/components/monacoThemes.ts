import type { BeforeMount } from '@monaco-editor/react';

let transparentThemesRegistered = false;

export const registerGonaviMonacoThemes: BeforeMount = (monaco) => {
  if (transparentThemesRegistered) {
    return;
  }

  const yamlValueTokens = ['string', 'number', 'number.float', 'number.hex', 'number.octal', 'number.infinity', 'number.nan', 'number.date'];
  monaco.editor.defineTheme('transparent-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      ...yamlValueTokens.map((token) => ({ token: token + '.yaml', foreground: 'CE9178' })),
      { token: 'keyword.sql', foreground: 'C792EA', fontStyle: 'bold' },
      { token: 'keyword.try.sql', foreground: 'C792EA', fontStyle: 'bold' },
      { token: 'keyword.catch.sql', foreground: 'C792EA', fontStyle: 'bold' },
      { token: 'keyword.block.sql', foreground: 'C792EA', fontStyle: 'bold' },
      { token: 'keyword.choice.sql', foreground: 'C792EA', fontStyle: 'bold' },
    ],
    colors: {
      'editor.background': '#00000000',
      'editor.lineHighlightBackground': '#ffffff10',
      'editorGutter.background': '#00000000',
      // Transparent sticky scroll so panel/theme bg shows through (CSS may also paint --gn-bg-panel).
      'editorStickyScroll.background': '#00000000',
      'editorStickyScrollHover.background': '#ffffff12',
    },
  });
  monaco.editor.defineTheme('transparent-light', {
    base: 'vs',
    inherit: true,
    rules: [
      ...yamlValueTokens.map((token) => ({ token: token + '.yaml', foreground: '0451A5' })),
      { token: 'keyword.sql', foreground: '6D28D9', fontStyle: 'bold' },
      { token: 'keyword.try.sql', foreground: '6D28D9', fontStyle: 'bold' },
      { token: 'keyword.catch.sql', foreground: '6D28D9', fontStyle: 'bold' },
      { token: 'keyword.block.sql', foreground: '6D28D9', fontStyle: 'bold' },
      { token: 'keyword.choice.sql', foreground: '6D28D9', fontStyle: 'bold' },
    ],
    colors: {
      'editor.background': '#00000000',
      'editor.lineHighlightBackground': '#00000010',
      'editorGutter.background': '#00000000',
      'editorStickyScroll.background': '#00000000',
      'editorStickyScrollHover.background': '#00000010',
    },
  });

  transparentThemesRegistered = true;
};
