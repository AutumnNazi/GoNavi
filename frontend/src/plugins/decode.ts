import { PluginAPIError, requireRecord } from './apiResult';
import { boundedJSON } from './jsonBoundary';
import type { PluginInspection, PluginManifest, PluginRuntimeInfo, PluginStatus } from './types';

function invalid(): never {
  throw new PluginAPIError('plugin.error.invalid_response');
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function onlyUINode(value: Record<string, unknown>): void {
  onlyKeys(value, ['type', 'text', 'title', 'children', 'command', 'arguments', 'columns', 'rows']);
  if (Array.isArray(value.children)) for (const child of value.children) onlyUINode(requireRecord(child));
  if (Array.isArray(value.columns)) for (const column of value.columns) onlyKeys(requireRecord(column), ['key', 'title']);
}
const utf8Within = (value: string, limit: number) => new TextEncoder().encode(value).length <= limit;
function validDataSource(source: Record<string, unknown>, command: Record<string, unknown> | undefined): boolean {
  const effect = command?.effect;
  const port = source.defaultPort;
  return typeof source.id === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/.test(source.id)
    && typeof source.name === 'string' && source.name.trim() !== '' && utf8Within(source.name, 256) && !source.name.includes('\u0000')
    && typeof source.command === 'string' && source.readOnly === true
    && (source.dialect === 'mysql' || source.dialect === 'postgres' || source.dialect === 'sqlite') && command != null
    && (effect == null || effect === '' || effect === 'read' || effect === 'unknown')
    && (port == null || (typeof port === 'number' && Number.isInteger(port) && port >= 0 && port <= 65535));
}
function validExporter(exporter: Record<string, unknown>, commands: Map<string, Record<string, unknown>>): boolean {
  const command = typeof exporter.command === 'string' ? commands.get(exporter.command) : undefined;
  return typeof exporter.id === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/.test(exporter.id)
    && typeof exporter.name === 'string' && exporter.name.trim() !== '' && utf8Within(exporter.name, 256) && !exporter.name.includes('\u0000')
    && command != null && typeof exporter.extension === 'string' && /^[a-z0-9]{1,16}$/.test(exporter.extension)
    && typeof exporter.contentType === 'string' && /^(text|application)\/[a-z0-9][a-z0-9.+-]{0,63}$/.test(exporter.contentType)
    && (exporter.streaming === undefined || typeof exporter.streaming === 'boolean');
}
function validAIProvider(provider: Record<string, unknown>, commands: Map<string, Record<string, unknown>>): boolean {
  const command = typeof provider.command === 'string' ? commands.get(provider.command) : undefined;
  const models = provider.models;
  if (typeof provider.id !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(provider.id)
    || typeof provider.name !== 'string' || provider.name.trim() === '' || !utf8Within(provider.name, 256) || provider.name.includes('\u0000')
    || command == null || typeof provider.supportsTools !== 'boolean' || typeof provider.supportsImages !== 'boolean'
    || !Array.isArray(models) || models.length < 1 || models.length > 32) return false;
  const seen = new Set<string>();
  for (const item of models) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
    const model = item as Record<string, unknown>;
    onlyKeys(model, ['id', 'name', 'contextWindow', 'maxOutputTokens']);
    const id = model.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,127}$/.test(id) || seen.has(id)
      || typeof model.name !== 'string' || model.name.trim() === '' || !utf8Within(model.name, 256) || model.name.includes('\u0000')
      || typeof model.contextWindow !== 'number' || !Number.isInteger(model.contextWindow) || model.contextWindow < 1024 || model.contextWindow > 262144
      || typeof model.maxOutputTokens !== 'number' || !Number.isInteger(model.maxOutputTokens) || model.maxOutputTokens < 1 || model.maxOutputTokens > 65536
      || model.maxOutputTokens > model.contextWindow) return false;
    seen.add(id);
  }
  return true;
}
function reservedSkillSegment(part: string): boolean {
  const base = part.split('.')[0].toUpperCase();
  if (['CON', 'PRN', 'AUX', 'NUL', 'CLOCK$', 'CONIN$', 'CONOUT$'].includes(base)) return true;
  if (!base.startsWith('COM') && !base.startsWith('LPT')) return false;
  const suffix = base.slice(3);
  return suffix.length === 1 && suffix >= '0' && suffix <= '9' || suffix === '¹' || suffix === '²' || suffix === '³';
}
function validVersion(value: string): boolean {
  if (value.startsWith('v') || value.length > 128) return false;
  const build = value.split('+');
  if (build.length > 2 || (build.length === 2 && !build[1].split('.').every((part) => /^[0-9A-Za-z-]+$/.test(part)))) return false;
  const pre = build[0].split('-');
  const numbers = pre[0].split('.');
  if (pre.length > 2 || numbers.length !== 3 || numbers.some((part) => !/^(0|[1-9]\d*)$/.test(part))) return false;
  return pre.length === 1 || pre[1].split('.').every((part) => part !== '' && (!/^\d+$/.test(part) || !/^0\d/.test(part)) && /^[0-9A-Za-z-]+$/.test(part));
}
function validLocalID(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}
function validPluginID(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/.test(value)) return false;
  return value.split('.').every((part) => part !== '' && !part.startsWith('-') && !part.endsWith('-'));
}
function validSchema(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return new TextEncoder().encode(JSON.stringify(value)).length <= 64 * 1024;
}
function validWindowEntry(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || !utf8Within(value, 1024) || /[\\:\u0000-\u001f<>"|?*]/.test(value) || value.startsWith('/')) return false;
  const parts = value.split('/');
  return parts.length <= 33 && parts.every((part) => part !== '' && part !== '.' && part !== '..' && utf8Within(part, 240) && !part.endsWith(' ') && !part.endsWith('.') && !reservedSkillSegment(part));
}
function validSkillPath(value: unknown, entry: boolean): value is string {
  if (typeof value !== 'string' || value.length === 0 || new TextEncoder().encode(value).length > 1024 || /[\\:\u0000-\u001f<>"|?*]/.test(value) || value.startsWith('/')) return false;
  const parts = value.split('/');
  if (parts.length > 33 || parts.some((part) => part === '' || part === '.' || part === '..' || new TextEncoder().encode(part).length > 240 || part.endsWith(' ') || part.endsWith('.') || reservedSkillSegment(part))) return false;
  const base = parts[parts.length - 1];
  return entry ? base === 'SKILL.md' : base.endsWith('.md') && base !== 'SKILL.md';
}
function validSkill(skill: Record<string, unknown>): boolean {
  const resources = skill.resources == null ? [] : skill.resources;
  if (typeof skill.id !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(skill.id)
    || typeof skill.name !== 'string' || skill.name.trim() === '' || new TextEncoder().encode(skill.name).length > 256 || skill.name.includes('\u0000')
    || typeof skill.description !== 'string' || skill.description.trim() === '' || new TextEncoder().encode(skill.description).length > 2048 || skill.description.includes('\u0000')
    || !validSkillPath(skill.entry, true) || !Array.isArray(resources) || resources.length > 4) return false;
  const seen = new Set<string>([skill.entry]);
  for (const resource of resources) {
    if (!validSkillPath(resource, false) || seen.has(resource)) return false;
    seen.add(resource);
  }
  return true;
}
export function decodeManifest(data: unknown): PluginManifest {
  boundedJSON(data, 128 * 1024, 64 * 1024);
  const raw = requireRecord(data);
  const allowed = new Set(['schemaVersion', 'apiVersion', 'id', 'name', 'version', 'description', 'author', 'license', 'minHostVersion', 'permissions', 'permissionNotes', 'requires', 'backend', 'contributes', 'window', 'configSchema']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) invalid();
  const m: Record<string, unknown> = { ...raw, permissions: raw.permissions ?? [] };
  if (m.schemaVersion !== 1 || m.apiVersion !== 1 || typeof m.id !== 'string' || typeof m.name !== 'string'
    || typeof m.version !== 'string' || !Array.isArray(m.permissions) || m.permissions.length > 64
    || m.permissions.some((p) => typeof p !== 'string')) invalid();
  const name = m.name as string;
  if (!validPluginID(m.id) || typeof m.version !== 'string' || !validVersion(m.version) || name.trim() === '' || !utf8Within(name, 256) || name.includes('\u0000')) invalid();
  const textLimits: Record<string, number> = { description: 16384, author: 512, license: 256 };
  for (const key of ['description', 'author', 'license', 'minHostVersion']) {
    const value = m[key];
    if (value == null) continue;
    if (typeof value !== 'string') invalid();
    const limit = textLimits[key];
    if (limit != null && !utf8Within(value, limit)) invalid();
    if (key === 'minHostVersion' && value !== '' && !validVersion(value)) invalid();
  }
  if (m.permissionNotes != null) {
    const notes = requireRecord(m.permissionNotes);
    const granted = new Set(m.permissions as string[]);
    const entries = Object.entries(notes);
    if (entries.length > granted.size) invalid();
    for (const [key, value] of entries) {
      if (!granted.has(key) || typeof value !== 'string' || value.trim() === '' || !utf8Within(value, 160) || /[<>\u0000-\u001f\u007f]/.test(value)) invalid();
    }
  }
  if (m.requires != null) {
    if (!Array.isArray(m.requires) || m.requires.length > 64) return invalid();
    const seenDeps = new Set<string>();
    for (const dependency of m.requires) {
      const entry = requireRecord(dependency);
      onlyKeys(entry, ['id', 'minVersion', 'optional']);
      if (!validPluginID(entry.id) || entry.id === m.id || seenDeps.has(entry.id)
        || (entry.minVersion != null && (typeof entry.minVersion !== 'string' || (entry.minVersion !== '' && !validVersion(entry.minVersion))))
        || (entry.optional != null && typeof entry.optional !== 'boolean')) invalid();
      seenDeps.add(entry.id as string);
    }
  }
  if (m.contributes != null) {
    const c = requireRecord(m.contributes);
    onlyKeys(c, ['commands', 'panels', 'dataSources', 'skills', 'aiProviders', 'exporters']);
    const contributionLimits: Record<string, number> = { commands: 128, panels: 32 };
    for (const key of ['commands', 'panels']) {
      const entries = c[key];
      if (entries == null) continue;
      if (!Array.isArray(entries) || entries.length > contributionLimits[key]) return invalid();
      const seen = new Set<string>();
      for (const item of entries) {
        const entry = requireRecord(item);
        onlyKeys(entry, key === 'commands' ? ['id', 'title', 'description', 'inputSchema', 'effect'] : ['id', 'title', 'body', 'html']);
        if (key === 'panels') {
          const hasBody = entry.body != null;
          const hasHTML = entry.html != null;
          if (hasBody === hasHTML) invalid();
          if (hasBody) onlyUINode(requireRecord(entry.body));
          if (hasHTML) {
            if (!(m.permissions as string[]).includes('ui.html-panel')) invalid();
            const html = requireRecord(entry.html);
            onlyKeys(html, ['source']);
            if (typeof html.source !== 'string' || html.source.trim() === '' || !utf8Within(html.source, 256 << 10) || html.source.includes('\u0000')) invalid();
          }
        }
        const id = entry.id;
        if (!validLocalID(id) || seen.has(id) || typeof entry.title !== 'string' || entry.title.trim() === '' || !utf8Within(entry.title, 256) || entry.title.includes('\u0000')) invalid();
        seen.add(id);
        if (key === 'commands' && entry.effect != null && entry.effect !== '' && entry.effect !== 'read' && entry.effect !== 'write' && entry.effect !== 'unknown') invalid();
        if (key === 'commands' && entry.description != null && (typeof entry.description !== 'string' || !utf8Within(entry.description, 4096))) invalid();
        if (key === 'commands' && Object.prototype.hasOwnProperty.call(entry, 'inputSchema') && !validSchema(entry.inputSchema)) invalid();
      }
    }
    if (c.dataSources != null) {
      if (!Array.isArray(c.dataSources) || c.dataSources.length > 8) return invalid();
      const commands = new Map<string, Record<string, unknown>>();
      for (const item of Array.isArray(c.commands) ? c.commands : []) {
        const entry = requireRecord(item);
        if (typeof entry.id === 'string') commands.set(entry.id, entry);
      }
      for (const item of c.dataSources) {
        const source = requireRecord(item);
        onlyKeys(source, ['id', 'name', 'dialect', 'command', 'defaultPort', 'readOnly']);
        const command = typeof source.command === 'string' ? commands.get(source.command) : undefined;
        if (!validDataSource(source, command)) invalid();
      }
    }
    if (c.exporters != null) {
      if (!Array.isArray(c.exporters) || c.exporters.length > 8) return invalid();
      const commands = new Map<string, Record<string, unknown>>();
      for (const item of Array.isArray(c.commands) ? c.commands : []) {
        const entry = requireRecord(item);
        if (typeof entry.id === 'string') commands.set(entry.id, entry);
      }
      for (const item of c.exporters) {
        const exporter = requireRecord(item);
        onlyKeys(exporter, ['id', 'name', 'command', 'extension', 'contentType', 'streaming']);
        if (!validExporter(exporter, commands)) invalid();
      }
    }
    if (c.aiProviders != null) {
      if (!Array.isArray(c.aiProviders) || c.aiProviders.length > 8) return invalid();
      const commands = new Map<string, Record<string, unknown>>();
      for (const item of Array.isArray(c.commands) ? c.commands : []) {
        const entry = requireRecord(item);
        if (typeof entry.id === 'string') commands.set(entry.id, entry);
      }
      for (const item of c.aiProviders) {
        const provider = requireRecord(item);
        onlyKeys(provider, ['id', 'name', 'command', 'models', 'supportsTools', 'supportsImages']);
        if (!validAIProvider(provider, commands)) invalid();
      }
    }
    if (c.skills != null) {
      if (!Array.isArray(c.skills) || c.skills.length > 16 || !(m.permissions as string[]).includes('ai.skills')) return invalid();
      const seen = new Set<string>();
      for (const item of c.skills) {
        const skill = requireRecord(item);
        onlyKeys(skill, ['id', 'name', 'description', 'entry', 'resources']);
        if (!validSkill(skill)) invalid();
        const skillId = skill.id;
        if (typeof skillId !== 'string' || seen.has(skillId)) invalid();
        seen.add(skillId);
      }
    }
  }
  if (m.backend != null) {
    const backend = requireRecord(m.backend);
    onlyKeys(backend, ['default', 'platforms']);
    const entryKeys = ['executable', 'args', 'runtime'];
    if (backend.default != null) onlyKeys(requireRecord(backend.default), entryKeys);
    if (backend.platforms != null) {
      for (const entry of Object.values(requireRecord(backend.platforms))) onlyKeys(requireRecord(entry), entryKeys);
    }
  }
  if (Object.prototype.hasOwnProperty.call(m, 'configSchema') && !validSchema(m.configSchema)) invalid();
  if (m.window != null) {
    const view = requireRecord(m.window);
    onlyKeys(view, ['entry', 'title', 'width', 'height']);
    if (!validWindowEntry(view.entry)) invalid();
    if (view.title != null && (typeof view.title !== 'string' || !utf8Within(view.title, 256))) invalid();
    for (const key of ['width', 'height']) {
      const size = view[key];
      if (size != null && (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > 8192)) invalid();
    }
  }
  return m as unknown as PluginManifest;
}
export function decodeStatus(data: unknown): PluginStatus {
  const s = requireRecord(data);
  if (s.lastError != null && (typeof s.lastError !== 'string' || s.lastError.length > 8192)) invalid();
  const manifest = decodeManifest(s.manifest);
  if (!['disabled', 'starting', 'running', 'stopping', 'faulted', 'blocked'].includes(String(s.state))
    || typeof s.desiredEnabled !== 'boolean' || typeof s.digest !== 'string'
    || typeof s.generation !== 'number' || !Number.isSafeInteger(s.generation) || typeof s.installedAt !== 'string') invalid();
  return { ...s, manifest } as unknown as PluginStatus;
}
export function decodeStatuses(data: unknown): PluginStatus[] {
  if (!Array.isArray(data) || data.length > 500) return invalid();
  return data.map(decodeStatus);
}
export function decodeInspection(data: unknown): PluginInspection {
  const i = requireRecord(data);
  const manifest = decodeManifest(i.manifest);
  if (typeof i.digest !== 'string' || !/^[a-f0-9]{64}$/i.test(i.digest)
    || typeof i.sourcePath !== 'string' || typeof i.sizeBytes !== 'number' || i.sizeBytes < 0) invalid();
  return { ...i, manifest } as unknown as PluginInspection;
}
export function decodeRuntime(data: unknown): PluginRuntimeInfo {
  const r = requireRecord(data);
  if (typeof r.safeMode !== 'boolean' || typeof r.managementAllowed !== 'boolean'
    || (r.webRuntime !== undefined && typeof r.webRuntime !== 'boolean')) invalid();
  return r as unknown as PluginRuntimeInfo;
}
