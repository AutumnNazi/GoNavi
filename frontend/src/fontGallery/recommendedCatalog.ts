export interface RecommendedFont {
  id: string;
  kind: 'ui' | 'mono';
  family: string;
  names: Record<string, string>;
  description: string;
  useCase: string;
  sourceUrl: string;
  licenseName: string;
}

export const RECOMMENDED_FONTS: RecommendedFont[] = [
  { id: 'jetbrains-mono', kind: 'mono', family: 'JetBrains Mono', names: { 'en-US': 'JetBrains Mono', 'zh-CN': 'JetBrains Mono' }, description: 'Programming ligatures and a clear italic.', useCase: 'SQL editor, logs, AI code blocks', sourceUrl: 'https://www.jetbrains.com/lp/mono/', licenseName: 'OFL-1.1' },
  { id: 'cascadia-code', kind: 'mono', family: 'Cascadia Code', names: { 'en-US': 'Cascadia Code', 'zh-CN': 'Cascadia Code' }, description: 'Windows Terminal family with optional ligatures.', useCase: 'SQL editor and console output', sourceUrl: 'https://github.com/microsoft/cascadia-code', licenseName: 'OFL-1.1' },
  { id: 'fira-code', kind: 'mono', family: 'Fira Code', names: { 'en-US': 'Fira Code', 'zh-CN': 'Fira Code' }, description: 'Monospace font with programming ligatures.', useCase: 'SQL editor', sourceUrl: 'https://github.com/tonsky/FiraCode', licenseName: 'OFL-1.1' },
  { id: 'ibm-plex-mono', kind: 'mono', family: 'IBM Plex Mono', names: { 'en-US': 'IBM Plex Mono', 'zh-CN': 'IBM Plex Mono' }, description: 'IBM Plex monospace for long reading sessions.', useCase: 'SQL editor and data grid', sourceUrl: 'https://github.com/IBM/plex', licenseName: 'OFL-1.1' },
  { id: 'iosevka', kind: 'mono', family: 'Iosevka', names: { 'en-US': 'Iosevka', 'zh-CN': 'Iosevka' }, description: 'Narrow, highly distinguishable glyphs.', useCase: 'Dense SQL and logs', sourceUrl: 'https://github.com/be5invis/Iosevka', licenseName: 'OFL-1.1' },
  { id: 'hack', kind: 'mono', family: 'Hack', names: { 'en-US': 'Hack', 'zh-CN': 'Hack' }, description: 'A typeface designed for source code.', useCase: 'SQL editor', sourceUrl: 'https://github.com/source-foundry/Hack', licenseName: 'MIT' },
  { id: 'ubuntu-mono', kind: 'mono', family: 'Ubuntu Mono', names: { 'en-US': 'Ubuntu Mono', 'zh-CN': 'Ubuntu Mono' }, description: 'Ubuntu console typeface.', useCase: 'SQL editor and terminal-like panels', sourceUrl: 'https://design.ubuntu.com/font/', licenseName: 'Ubuntu Font Licence' },
  { id: 'roboto-mono', kind: 'mono', family: 'Roboto Mono', names: { 'en-US': 'Roboto Mono', 'zh-CN': 'Roboto Mono' }, description: 'Geometric monospace companion to Roboto.', useCase: 'SQL editor', sourceUrl: 'https://github.com/googlefonts/RobotoMono', licenseName: 'Apache-2.0' },
  { id: 'inconsolata', kind: 'mono', family: 'Inconsolata', names: { 'en-US': 'Inconsolata', 'zh-CN': 'Inconsolata' }, description: 'Humanist monospace inspired by Consolas.', useCase: 'SQL editor', sourceUrl: 'https://github.com/googlefonts/inconsolata', licenseName: 'OFL-1.1' },
  { id: 'source-code-pro', kind: 'mono', family: 'Source Code Pro', names: { 'en-US': 'Source Code Pro', 'zh-CN': 'Source Code Pro' }, description: 'Adobe Source Code Pro.', useCase: 'SQL editor', sourceUrl: 'https://github.com/adobe-fonts/source-code-pro', licenseName: 'OFL-1.1' },
  { id: 'sarasa-gothic-sc', kind: 'mono', family: 'Sarasa Gothic SC', names: { 'en-US': 'Sarasa Gothic SC', 'zh-CN': '更纱黑体 SC' }, description: 'CJK programming font based on Iosevka and Source Han.', useCase: 'SQL with Chinese comments', sourceUrl: 'https://github.com/be5invis/Sarasa-Gothic', licenseName: 'OFL-1.1' },
];
