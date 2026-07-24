import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const detachedEntrySource = readFileSync(
  fileURLToPath(new globalThis.URL('./nativeDetachedMain.tsx', import.meta.url)),
  'utf8',
);
const detachedAppSource = readFileSync(
  fileURLToPath(new globalThis.URL('./components/NativeDetachedWindowApp.tsx', import.meta.url)),
  'utf8',
);
const aiChatPanelSource = readFileSync(
  fileURLToPath(new globalThis.URL('./components/AIChatPanel.tsx', import.meta.url)),
  'utf8',
);
const dataGridSource = readFileSync(
  fileURLToPath(new globalThis.URL('./components/DataGrid.tsx', import.meta.url)),
  'utf8',
);
const workbenchContentSource = readFileSync(
  fileURLToPath(new globalThis.URL('./components/WorkbenchTabContent.tsx', import.meta.url)),
  'utf8',
);
const workbenchThemeSource = readFileSync(
  fileURLToPath(new globalThis.URL('./styles/v2-theme-workbench.css', import.meta.url)),
  'utf8',
);
const aiThemeSource = readFileSync(
  fileURLToPath(new globalThis.URL('./styles/v2-theme-ai.css', import.meta.url)),
  'utf8',
);

describe('native detached window styles', () => {
  it('keeps feature styles out of the detached entry bootstrap', () => {
    expect(detachedEntrySource).toContain("import './App.css';");
    expect(detachedEntrySource).toContain("import './v2-theme.css';");
    expect(detachedEntrySource).not.toContain("import './styles/v2-theme-workbench.css';");
    expect(detachedEntrySource).not.toContain("import './styles/v2-theme-ai.css';");
  });

  it('loads workbench and AI assets only from their feature paths', () => {
    expect(detachedAppSource).toContain(
      "const WorkbenchTabContent = React.lazy(() => import('./WorkbenchTabContent'));",
    );
    expect(detachedAppSource).not.toMatch(/import\s+WorkbenchTabContent\s+from/);
    expect(aiChatPanelSource).toContain("import '../styles/v2-theme-ai.css';");
    expect(workbenchContentSource).toContain("import '../styles/v2-theme-workbench.css';");
    expect(dataGridSource).toContain("import '../styles/v2-theme-workbench.css';");
    expect(workbenchThemeSource).not.toContain('.gn-v2-ai-panel');
    expect(aiThemeSource).not.toContain('.gn-v2-data-grid-column-quick-find');
  });

  it('keeps the v2 AI header actions inside the frameless window edge', () => {
    expect(aiThemeSource).toMatch(
      /body\[data-ui-version="v2"\] \.gn-v2-ai-header-top \{[^}]*box-sizing: border-box;/s,
    );
  });
});
