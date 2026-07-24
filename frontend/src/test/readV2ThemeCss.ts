import { readFileSync } from 'node:fs';

export const readV2ThemeCss = (): string => [
  readFileSync(new URL('../v2-theme.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../styles/v2-theme-workbench.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../styles/v2-theme-ai.css', import.meta.url), 'utf8'),
].join('\n');
