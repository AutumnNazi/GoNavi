import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const occurrences = (source: string, value: string): number => source.split(value).length - 1;

describe('application user-action SQL audit coverage', () => {
  it('audits explicit TableDesigner writes with one stable source', () => {
    const source = read('../TableDesigner.tsx');

    expect(source).toContain('DBQueryAudited');
    expect(occurrences(source, 'DBQueryAudited(')).toBe(5);
    expect(occurrences(source, "'table_designer'")).toBe(5);
    expect(source).not.toContain('DBQuery(');
  });

  it('audits explicit message publication', () => {
    const source = read('../MessagePublishModal.tsx');

    expect(source).toContain('DBQueryAudited(');
    expect(source).toContain("'message_publish'");
    expect(source).not.toContain('DBQuery(');
  });

  it('routes AI database probes through the fixed-source backend method', () => {
    const runtimeSource = read('../ai/aiLocalToolRuntime.ts');
    const codeBlockSource = read('../ai/messageBubble/AIMessageCodeBlock.tsx');

    expect(runtimeSource).toContain('mod.DBQueryAI(config, dbName, sql)');
    expect(codeBlockSource).toContain('DBQueryAI(activeConnectionConfig');
    expect(runtimeSource).not.toContain('mod.DBQuery(config, dbName, sql)');
  });

  it('keeps metadata, counts, browsing, and definition reads outside application audit', () => {
    const readOnlySources = [
      read('../DataViewer.tsx'),
      read('../DefinitionViewer.tsx'),
      read('../TriggerViewer.tsx'),
      read('../TableOverview.tsx'),
      read('../sidebar/sidebarMetadataLoaders.ts'),
      read('../sidebar/useSidebarTreeLoaders.tsx'),
      read('../sidebar/useSidebarV2ContextMenu.tsx'),
    ];

    readOnlySources.forEach((source) => {
      expect(source).toContain('DBQuery');
      expect(source).not.toContain('DBQueryAudited');
    });
  });
});
