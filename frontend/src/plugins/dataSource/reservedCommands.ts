import type { PluginCommand, PluginManifest } from '../types';
import { isRecord } from '../jsonBoundary';

export function publicPluginCommands(manifest: PluginManifest): PluginCommand[] {
  const contributions = manifest.contributes as { dataSources?: unknown; aiProviders?: unknown; exporters?: unknown } | undefined;
  const declared: unknown = contributions?.dataSources;
  const aiProviders: unknown = contributions?.aiProviders;
  const commands = manifest.contributes?.commands ?? [];
  const reserved = new Set<string>();
  for (const entries of [declared, aiProviders, contributions?.exporters]) {
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > 8) return [];
    for (const source of entries) {
    if (!isRecord(source) || typeof source.command !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$(?![\s\S])/.test(source.command)) return [];
      reserved.add(source.command);
    }
  }
  return commands.filter((command) => !reserved.has(command.id));
}
