import {
  CUSTOM_THEME_SCHEMA_VERSION,
  resolveActiveCustomTheme,
  type CustomThemeDefinition,
} from './customTheme';

type BuiltinThemePalette = {
  mode: 'light' | 'dark';
  app: string;
  chrome: string;
  panel: string;
  panel2: string;
  input: string;
  hover: string;
  active: string;
  selected: string;
  fg1: string;
  fg2: string;
  fg3: string;
  fg4: string;
  fg5: string;
  border1: string;
  border2: string;
  border3: string;
  accent: string;
  accent2: string;
  accentSoft: string;
  accentSoftHover: string;
  accentOutline: string;
  onAccent: string;
  info: string;
  infoSoft: string;
  onInfo: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerStrong: string;
  dangerHover: string;
  onDanger: string;
  purple: string;
  purpleSoft: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  shadowCard: string;
  kbdBg: string;
  kbdFg: string;
};

export type BuiltinCustomThemePreset = CustomThemeDefinition & {
  kind: 'builtin';
  nameKey: string;
  descriptionKey: string;
  badgeKey?: string;
  preview: {
    app: string;
    chrome: string;
    panel: string;
    text: string;
    muted: string;
    accent: string;
  };
};

const BUILTIN_THEME_REVISION = 2026071301;

const createBuiltinThemeCss = (id: string, palette: BuiltinThemePalette): string => `/* GoNavi built-in theme: ${id} */
body[data-custom-theme],
body[data-custom-theme][data-ui-version="v2"] {
  color-scheme: ${palette.mode};
  --gn-bg-app: ${palette.app};
  --gn-bg-chrome: ${palette.chrome};
  --gn-bg-panel: ${palette.panel};
  --gn-bg-panel-2: ${palette.panel2};
  --gn-bg-input: ${palette.input};
  --gn-bg-subtle: ${palette.panel2};
  --gn-bg-hover: ${palette.hover};
  --gn-bg-active: ${palette.active};
  --gn-bg-selected: ${palette.selected};

  --gn-fg-1: ${palette.fg1};
  --gn-fg-2: ${palette.fg2};
  --gn-fg-3: ${palette.fg3};
  --gn-fg-4: ${palette.fg4};
  --gn-fg-5: ${palette.fg5};
  --gn-text-muted: ${palette.fg4};

  --gn-br-1: ${palette.border1};
  --gn-br-2: ${palette.border2};
  --gn-br-3: ${palette.border3};

  --gn-accent: ${palette.accent};
  --gn-accent-2: ${palette.accent2};
  --gn-accent-soft: ${palette.accentSoft};
  --gn-accent-text: ${palette.accent};
  --gn-accent-fill: ${palette.accent};
  --gn-accent-fill-hover: ${palette.accent2};
  --gn-on-accent: ${palette.onAccent};
  --gn-focus-ring: ${palette.accentOutline};

  --gn-info: ${palette.info};
  --gn-info-soft: ${palette.infoSoft};
  --gn-on-info: ${palette.onInfo};
  --gn-warn: ${palette.warn};
  --gn-warn-soft: ${palette.warnSoft};
  --gn-danger: ${palette.danger};
  --gn-danger-strong: ${palette.dangerStrong};
  --gn-danger-strong-hover: ${palette.dangerHover};
  --gn-on-danger: ${palette.onDanger};
  --gn-status-connected: ${palette.mode === 'dark' ? '#4ade80' : '#15803d'};
  --gn-purple: ${palette.purple};
  --gn-purple-soft: ${palette.purpleSoft};

  --gn-shadow-sm: ${palette.shadowSm};
  --gn-shadow-md: ${palette.shadowMd};
  --gn-shadow-lg: ${palette.shadowLg};
  --gn-shadow-card: ${palette.shadowCard};
  --gn-kbd-bg: ${palette.kbdBg};
  --gn-kbd-fg: ${palette.kbdFg};

  --gn-ant-primary: ${palette.accent};
  --gn-ant-primary-hover: ${palette.accent2};
  --gn-ant-primary-active: ${palette.accent2};
  --gn-ant-primary-bg: ${palette.accentSoft};
  --gn-ant-primary-bg-hover: ${palette.accentSoftHover};
  --gn-ant-primary-border: ${palette.accent};
  --gn-ant-primary-border-hover: ${palette.accent2};
  --gn-ant-control-active-bg: ${palette.accentSoft};
  --gn-ant-control-active-hover-bg: ${palette.accentSoftHover};
  --gn-ant-control-outline: ${palette.accentOutline};
  --gn-ant-on-primary: ${palette.onAccent};

  --gn-explain-scan: ${palette.danger};
  --gn-explain-index-scan: ${palette.info};
  --gn-explain-index-only: ${palette.accent};
  --gn-explain-join: ${palette.info};
  --gn-explain-aggregate: ${palette.purple};
  --gn-explain-sort: ${palette.warn};
  --gn-explain-limit: ${palette.fg3};
  --gn-explain-filter: ${palette.fg3};
  --gn-explain-subquery: ${palette.purple};
  --gn-explain-materialize: ${palette.warn};
  --gn-explain-other: ${palette.fg4};
  --gn-explain-critical: ${palette.dangerStrong};
  --gn-explain-warning: ${palette.warn};
  --gn-explain-info: ${palette.info};
}

body[data-custom-theme] .gonavi-theme-settings,
body[data-custom-theme] .gonavi-custom-theme-manager.is-legacy {
  --gn-settings-fg: var(--gn-fg-1);
  --gn-settings-muted: var(--gn-fg-4);
  --gn-settings-line: var(--gn-br-2);
  --gn-settings-track: var(--gn-br-3);
  --gn-settings-chip-bg: var(--gn-bg-panel-2);
  --gn-settings-chip-fg: var(--gn-fg-2);
  --gn-settings-seg-bg: var(--gn-bg-panel-2);
  --gn-settings-seg-border: var(--gn-br-2);
  --gn-settings-seg-item: var(--gn-fg-4);
  --gn-settings-seg-selected-bg: var(--gn-bg-panel);
  --gn-settings-seg-selected-fg: var(--gn-fg-1);
  --gn-settings-seg-shadow: var(--gn-shadow-sm);
  --gn-settings-accent: var(--gn-accent-text, var(--gn-accent));
  --gn-settings-accent-soft: var(--gn-accent-soft);
  --gn-settings-accent-border: var(--gn-ant-primary-border);
  --gn-settings-card-bg: var(--gn-bg-panel);
}

body[data-custom-theme][data-ui-version="v2"] .ant-btn-primary:not(.ant-btn-dangerous):not(:disabled):not(.ant-btn-disabled) {
  color: var(--gn-on-accent, #fff) !important;
}

body[data-custom-theme][data-ui-version="v2"] .ant-btn-primary.ant-btn-dangerous:not(:disabled):not(.ant-btn-disabled) {
  color: var(--gn-on-danger, #fff) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-query-transaction-commit-button:hover,
body[data-custom-theme][data-ui-version="v2"] .gn-v2-query-transaction-commit-button:focus,
body[data-custom-theme][data-ui-version="v2"] .gn-v2-query-transaction-commit-button:focus-visible,
body[data-custom-theme][data-ui-version="v2"] .gn-v2-query-transaction-commit-button:active {
  border-color: var(--gn-ant-primary-border) !important;
  background: var(--gn-ant-primary-bg-hover) !important;
  box-shadow: 0 0 0 1px var(--gn-ant-control-outline), var(--gn-shadow-sm) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-query-transaction-commit-button .gn-v2-toolbar-kbd {
  background: var(--gn-ant-primary-bg) !important;
  color: var(--gn-accent-text, var(--gn-accent)) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-query-toolbar-save-action.ant-btn-primary:not(:disabled) {
  background: var(--gn-info) !important;
  border-color: var(--gn-info) !important;
  color: var(--gn-on-info, #fff) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-query-toolbar-save-action.ant-btn-primary:not(:disabled):hover,
body[data-custom-theme][data-ui-version="v2"] .gn-v2-query-toolbar-save-action.ant-btn-primary:not(:disabled):focus-visible {
  background: color-mix(in srgb, var(--gn-info) 86%, var(--gn-bg-panel)) !important;
  border-color: color-mix(in srgb, var(--gn-info) 86%, var(--gn-bg-panel)) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-query-toolbar-save-action.ant-btn-primary:not(:disabled):active {
  background: color-mix(in srgb, var(--gn-info) 74%, var(--gn-bg-panel)) !important;
  border-color: color-mix(in srgb, var(--gn-info) 74%, var(--gn-bg-panel)) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-ai-panel .ai-logo {
  background: var(--gn-info) !important;
  color: var(--gn-on-info, #fff) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-ai-quick-card.tone-purple .gn-v2-ai-quick-icon {
  background: var(--gn-purple-soft) !important;
  color: var(--gn-purple) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-live-dot.is-live,
body[data-custom-theme][data-ui-version="v2"] .gn-v2-rail-status.is-live,
body[data-custom-theme][data-ui-version="v2"] .gn-v2-tree-status.is-success::before {
  background: var(--gn-status-connected) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--gn-status-connected) 22%, transparent) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-live-dot.is-loading,
body[data-custom-theme][data-ui-version="v2"] .gn-v2-tree-status.is-loading::before {
  border-color: var(--gn-info-soft) !important;
  border-top-color: var(--gn-info) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-tab-label-part-host {
  color: var(--gn-info) !important;
}

body[data-custom-theme][data-ui-version="v2"] .gn-v2-tab-label-part-database {
  color: var(--gn-accent) !important;
}

body[data-custom-theme][data-ui-version="v2"] .monaco-editor,
body[data-custom-theme][data-ui-version="v2"] .monaco-editor-background,
body[data-custom-theme][data-ui-version="v2"] .monaco-editor .margin,
body[data-custom-theme][data-ui-version="v2"] .monaco-editor .sticky-widget {
  background-color: var(--gn-bg-input) !important;
}`;

const createPreset = (
  id: string,
  name: string,
  nameKey: string,
  descriptionKey: string,
  palette: BuiltinThemePalette,
  badgeKey?: string,
): BuiltinCustomThemePreset => ({
  kind: 'builtin',
  schemaVersion: CUSTOM_THEME_SCHEMA_VERSION,
  id,
  name,
  nameKey,
  descriptionKey,
  badgeKey,
  sourceFileName: `${id}.css`,
  baseMode: palette.mode,
  css: createBuiltinThemeCss(id, palette),
  createdAt: BUILTIN_THEME_REVISION,
  updatedAt: BUILTIN_THEME_REVISION,
  preview: {
    app: palette.app,
    chrome: palette.chrome,
    panel: palette.panel,
    text: palette.fg1,
    muted: palette.fg4,
    accent: palette.accent,
  },
});

export const BUILTIN_CUSTOM_THEME_PRESETS: readonly BuiltinCustomThemePreset[] = [
  createPreset(
    'builtin-comfort-dark',
    'Comfort Dark',
    'app.theme.custom.preset.comfort_dark.name',
    'app.theme.custom.preset.comfort_dark.description',
    {
      mode: 'dark', app: '#1b1d21', chrome: '#1f2227', panel: '#24272d', panel2: '#292d34', input: '#202329',
      hover: 'rgba(226, 232, 240, 0.045)', active: 'rgba(226, 232, 240, 0.075)', selected: 'rgba(121, 166, 147, 0.14)',
      fg1: '#d2d5da', fg2: '#bbc0c7', fg3: '#9ea5ae', fg4: '#9299a3', fg5: '#878e98',
      border1: 'rgba(226, 232, 240, 0.06)', border2: 'rgba(226, 232, 240, 0.10)', border3: 'rgba(226, 232, 240, 0.16)',
      accent: '#79a693', accent2: '#6b9887', accentSoft: 'rgba(121, 166, 147, 0.16)', accentSoftHover: 'rgba(121, 166, 147, 0.24)', accentOutline: 'rgba(141, 183, 166, 0.38)', onAccent: '#142019',
      info: '#79a6c9', infoSoft: 'rgba(121, 166, 201, 0.14)', onInfo: '#10202d', warn: '#c6a15b', warnSoft: 'rgba(198, 161, 91, 0.15)', danger: '#d47777', dangerStrong: '#b3575d', dangerHover: '#a74f56', onDanger: '#ffffff', purple: '#9b8ab5', purpleSoft: 'rgba(155, 138, 181, 0.16)',
      shadowSm: '0 1px 2px rgba(0, 0, 0, 0.16)', shadowMd: '0 4px 14px rgba(0, 0, 0, 0.24)', shadowLg: '0 12px 36px rgba(0, 0, 0, 0.32)', shadowCard: '0 0 0 0.5px rgba(255, 255, 255, 0.07), 0 1px 3px rgba(0, 0, 0, 0.18)',
      kbdBg: '#2d3138', kbdFg: '#bbc0c7',
    },
    'app.theme.custom.preset.badge.recommended',
  ),
  createPreset(
    'builtin-midnight-navy',
    'Midnight Navy',
    'app.theme.custom.preset.midnight_navy.name',
    'app.theme.custom.preset.midnight_navy.description',
    {
      mode: 'dark', app: '#111821', chrome: '#15202c', panel: '#192533', panel2: '#1e2b3a', input: '#141e2a',
      hover: 'rgba(199, 210, 223, 0.05)', active: 'rgba(199, 210, 223, 0.08)', selected: 'rgba(104, 160, 200, 0.16)',
      fg1: '#e1e8f0', fg2: '#c7d2df', fg3: '#a8b7c7', fg4: '#8497aa', fg5: '#7a8e9f',
      border1: 'rgba(199, 210, 223, 0.06)', border2: 'rgba(199, 210, 223, 0.11)', border3: 'rgba(199, 210, 223, 0.18)',
      accent: '#68a0c8', accent2: '#5c91b8', accentSoft: 'rgba(104, 160, 200, 0.16)', accentSoftHover: 'rgba(104, 160, 200, 0.24)', accentOutline: 'rgba(104, 160, 200, 0.40)', onAccent: '#10202d',
      info: '#6cb6d9', infoSoft: 'rgba(108, 182, 217, 0.15)', onInfo: '#10202d', warn: '#d0a85c', warnSoft: 'rgba(208, 168, 92, 0.16)', danger: '#df7d84', dangerStrong: '#b15860', dangerHover: '#a04d55', onDanger: '#ffffff', purple: '#9c8bc4', purpleSoft: 'rgba(156, 139, 196, 0.16)',
      shadowSm: '0 1px 2px rgba(0, 0, 0, 0.20)', shadowMd: '0 4px 14px rgba(0, 0, 0, 0.28)', shadowLg: '0 12px 38px rgba(0, 0, 0, 0.38)', shadowCard: '0 0 0 0.5px rgba(199, 210, 223, 0.07), 0 1px 3px rgba(0, 0, 0, 0.22)',
      kbdBg: '#223142', kbdFg: '#c7d2df',
    },
  ),
  createPreset(
    'builtin-nord-slate',
    'Nord Slate',
    'app.theme.custom.preset.nord_slate.name',
    'app.theme.custom.preset.nord_slate.description',
    {
      mode: 'dark', app: '#282e38', chrome: '#2b313c', panel: '#2e3440', panel2: '#353c49', input: '#292f3a',
      hover: 'rgba(216, 222, 233, 0.055)', active: 'rgba(216, 222, 233, 0.09)', selected: 'rgba(136, 192, 208, 0.16)',
      fg1: '#eceff4', fg2: '#d8dee9', fg3: '#c1cad8', fg4: '#9aa7b8', fg5: '#929ead',
      border1: 'rgba(216, 222, 233, 0.07)', border2: 'rgba(216, 222, 233, 0.12)', border3: 'rgba(216, 222, 233, 0.20)',
      accent: '#88c0d0', accent2: '#6faabb', accentSoft: 'rgba(136, 192, 208, 0.16)', accentSoftHover: 'rgba(136, 192, 208, 0.24)', accentOutline: 'rgba(136, 192, 208, 0.42)', onAccent: '#17252a',
      info: '#89add0', infoSoft: 'rgba(137, 173, 208, 0.17)', onInfo: '#17212b', warn: '#ebcb8b', warnSoft: 'rgba(235, 203, 139, 0.16)', danger: '#df858d', dangerStrong: '#a94f59', dangerHover: '#943f49', onDanger: '#ffffff', purple: '#b993b2', purpleSoft: 'rgba(185, 147, 178, 0.17)',
      shadowSm: '0 1px 2px rgba(20, 24, 31, 0.24)', shadowMd: '0 4px 14px rgba(20, 24, 31, 0.32)', shadowLg: '0 12px 38px rgba(20, 24, 31, 0.42)', shadowCard: '0 0 0 0.5px rgba(216, 222, 233, 0.08), 0 1px 3px rgba(20, 24, 31, 0.25)',
      kbdBg: '#3b4351', kbdFg: '#d8dee9',
    },
  ),
  createPreset(
    'builtin-deep-ocean',
    'Deep Ocean',
    'app.theme.custom.preset.deep_ocean.name',
    'app.theme.custom.preset.deep_ocean.description',
    {
      mode: 'dark', app: '#0f181c', chrome: '#142126', panel: '#18282e', panel2: '#1c2e35', input: '#111e23',
      hover: 'rgba(184, 214, 214, 0.05)', active: 'rgba(184, 214, 214, 0.08)', selected: 'rgba(98, 166, 163, 0.17)',
      fg1: '#deebea', fg2: '#c5d7d6', fg3: '#a6bcbb', fg4: '#879f9e', fg5: '#7b9392',
      border1: 'rgba(197, 215, 214, 0.06)', border2: 'rgba(197, 215, 214, 0.11)', border3: 'rgba(197, 215, 214, 0.18)',
      accent: '#62a6a3', accent2: '#66aaa6', accentSoft: 'rgba(98, 166, 163, 0.17)', accentSoftHover: 'rgba(98, 166, 163, 0.25)', accentOutline: 'rgba(117, 181, 178, 0.40)', onAccent: '#102321',
      info: '#69a9bd', infoSoft: 'rgba(105, 169, 189, 0.15)', onInfo: '#0d2026', warn: '#c5a36d', warnSoft: 'rgba(197, 163, 109, 0.16)', danger: '#cd787b', dangerStrong: '#b05a5f', dangerHover: '#9f4d52', onDanger: '#ffffff', purple: '#9b8bb3', purpleSoft: 'rgba(155, 139, 179, 0.16)',
      shadowSm: '0 1px 2px rgba(0, 0, 0, 0.22)', shadowMd: '0 4px 14px rgba(0, 0, 0, 0.30)', shadowLg: '0 12px 38px rgba(0, 0, 0, 0.40)', shadowCard: '0 0 0 0.5px rgba(197, 215, 214, 0.07), 0 1px 3px rgba(0, 0, 0, 0.24)',
      kbdBg: '#21363d', kbdFg: '#c5d7d6',
    },
  ),
  createPreset(
    'builtin-warm-paper',
    'Warm Paper',
    'app.theme.custom.preset.warm_paper.name',
    'app.theme.custom.preset.warm_paper.description',
    {
      mode: 'light', app: '#f4f0e7', chrome: '#eae4d8', panel: '#fffcf5', panel2: '#f8f3e9', input: '#fffdf8',
      hover: 'rgba(67, 59, 49, 0.05)', active: 'rgba(67, 59, 49, 0.09)', selected: 'rgba(47, 125, 104, 0.14)',
      fg1: '#292722', fg2: '#45413a', fg3: '#655f55', fg4: '#766e63', fg5: '#7a7267',
      border1: 'rgba(67, 59, 49, 0.08)', border2: 'rgba(67, 59, 49, 0.13)', border3: 'rgba(67, 59, 49, 0.20)',
      accent: '#2d7864', accent2: '#236553', accentSoft: '#dcede6', accentSoftHover: '#cce4da', accentOutline: 'rgba(45, 120, 100, 0.30)', onAccent: '#ffffff',
      info: '#3572a4', infoSoft: '#ddeaf4', onInfo: '#ffffff', warn: '#9f5f1d', warnSoft: '#f2e4cf', danger: '#b94a4a', dangerStrong: '#a83c3c', dangerHover: '#923333', onDanger: '#ffffff', purple: '#765b93', purpleSoft: '#eae1f2',
      shadowSm: '0 1px 2px rgba(67, 59, 49, 0.07)', shadowMd: '0 4px 14px rgba(67, 59, 49, 0.10)', shadowLg: '0 12px 36px rgba(67, 59, 49, 0.16)', shadowCard: '0 0 0 0.5px rgba(67, 59, 49, 0.10), 0 1px 3px rgba(67, 59, 49, 0.07)',
      kbdBg: '#ece5d9', kbdFg: '#45413a',
    },
  ),
  createPreset(
    'builtin-mist-jade',
    'Mist Jade',
    'app.theme.custom.preset.mist_jade.name',
    'app.theme.custom.preset.mist_jade.description',
    {
      mode: 'light', app: '#eef4f0', chrome: '#e4eee8', panel: '#f7faf8', panel2: '#f1f6f3', input: '#ffffff',
      hover: 'rgba(38, 72, 60, 0.05)', active: 'rgba(38, 72, 60, 0.09)', selected: 'rgba(50, 122, 103, 0.14)',
      fg1: '#18231f', fg2: '#2d3d37', fg3: '#4d625a', fg4: '#5e7169', fg5: '#64776f',
      border1: 'rgba(38, 72, 60, 0.08)', border2: 'rgba(38, 72, 60, 0.13)', border3: 'rgba(38, 72, 60, 0.20)',
      accent: '#327a67', accent2: '#286452', accentSoft: '#d9ece5', accentSoftHover: '#c8e3d9', accentOutline: 'rgba(50, 122, 103, 0.30)', onAccent: '#ffffff',
      info: '#327386', infoSoft: '#dcebef', onInfo: '#ffffff', warn: '#946329', warnSoft: '#efe4d3', danger: '#b54f5e', dangerStrong: '#a43e4e', dangerHover: '#903442', onDanger: '#ffffff', purple: '#6f6590', purpleSoft: '#e5e1ee',
      shadowSm: '0 1px 2px rgba(38, 72, 60, 0.06)', shadowMd: '0 4px 14px rgba(38, 72, 60, 0.09)', shadowLg: '0 12px 36px rgba(38, 72, 60, 0.14)', shadowCard: '0 0 0 0.5px rgba(38, 72, 60, 0.10), 0 1px 3px rgba(38, 72, 60, 0.06)',
      kbdBg: '#e3ece7', kbdFg: '#2d3d37',
    },
  ),
] as const;

const BUILTIN_CUSTOM_THEME_PRESET_MAP = new Map(
  BUILTIN_CUSTOM_THEME_PRESETS.map((preset) => [preset.id, preset]),
);

export const resolveBuiltinCustomThemePreset = (id: unknown): BuiltinCustomThemePreset | null => (
  typeof id === 'string' ? BUILTIN_CUSTOM_THEME_PRESET_MAP.get(id) ?? null : null
);

export const resolveAvailableCustomTheme = (
  themes: CustomThemeDefinition[],
  activeThemeId: unknown,
): CustomThemeDefinition | null => (
  resolveBuiltinCustomThemePreset(activeThemeId)
  ?? resolveActiveCustomTheme(themes, activeThemeId)
);
