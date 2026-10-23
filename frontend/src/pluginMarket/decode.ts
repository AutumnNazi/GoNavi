import { PluginAPIError, requireRecord } from '../plugins/apiResult';
import { boundedJSON } from '../plugins/jsonBoundary';
import { decodeManifest } from '../plugins/decode';
import type { CatalogPage, DeviceLogin, LoginStatus, MarketPlugin, MarketRating, MarketSettings } from './types';

const invalid = (): never => { throw new PluginAPIError('plugin.error.invalid_response'); };
export function safeHTTPURL(value: string): boolean {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
export function decodeMarketPlugin(data: unknown): MarketPlugin {
  boundedJSON(data);
  const raw = requireRecord(data);
  const p: Record<string, unknown> = { ...raw, platforms: raw.platforms ?? [] };
  if (['id', 'name', 'description', 'author', 'publisherId', 'version', 'updatedAt'].some((key) => typeof p[key] !== 'string')
    || typeof p.official !== 'boolean' || !Array.isArray(p.platforms) || p.platforms.some((item) => typeof item !== 'string')
    || typeof p.ratingAverage !== 'number' || p.ratingAverage < 0 || p.ratingAverage > 5
    || !Number.isSafeInteger(p.ratingCount) || Number(p.ratingCount) < 0
    || !Number.isSafeInteger(p.downloadCount) || Number(p.downloadCount) < 0) invalid();
  if (p.sourceId != null && typeof p.sourceId !== 'string') invalid();
  if (p.manifest != null) p.manifest = decodeManifest(p.manifest);
  if (p.artifact != null) {
    const a = requireRecord(p.artifact);
    if (typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(a.sha256) || typeof a.version !== 'string'
      || typeof a.url !== 'string' || typeof a.platform !== 'string' || typeof a.sizeBytes !== 'number' || a.sizeBytes < 0) invalid();
  }
  return p as unknown as MarketPlugin;
}
export function decodeCatalog(data: unknown): CatalogPage {
  const page = requireRecord(data);
  if (!Array.isArray(page.items) || page.items.length > 100 || (page.nextCursor != null && typeof page.nextCursor !== 'string')) return invalid();
  if (page.stale != null && typeof page.stale !== 'boolean') invalid();
  for (const key of ['error', 'cachedAt', 'sourceId']) if (page[key] != null && (typeof page[key] !== 'string' || String(page[key]).length > 4096)) invalid();
  return { ...page, items: page.items.map(decodeMarketPlugin) } as CatalogPage;
}
export function decodeRating(data: unknown): MarketRating {
  boundedJSON(data);
  const r = requireRecord(data);
  if (['userId', 'pluginId', 'body', 'version', 'updatedAt'].some((key) => typeof r[key] !== 'string')
    || !Number.isInteger(r.stars) || Number(r.stars) < 1 || Number(r.stars) > 5) invalid();
  return r as unknown as MarketRating;
}
export function decodeRatings(data: unknown): MarketRating[] {
  if (!Array.isArray(data) || data.length > 1000) return invalid();
  return data.map(decodeRating);
}
export function decodeSettings(data: unknown): MarketSettings {
  const s = requireRecord(data);
  if (typeof s.baseUrl !== 'string' || typeof s.authenticated !== 'boolean' || (s.trustedOfficial != null && typeof s.trustedOfficial !== 'boolean')) invalid();
  if (s.sourceId != null && typeof s.sourceId !== 'string') invalid();
  return s as unknown as MarketSettings;
}
export function decodeLogin(data: unknown): DeviceLogin {
  boundedJSON(data, 16384);
  const s = requireRecord(data);
  if (typeof s.verificationUri !== 'string' || !safeHTTPURL(s.verificationUri) || typeof s.userCode !== 'string'
    || typeof s.deviceCode !== 'string' || typeof s.intervalSeconds !== 'number' || !Number.isFinite(s.intervalSeconds)
    || typeof s.expiresIn !== 'number' || s.expiresIn <= 0 || s.expiresIn > 3600) invalid();
  return s as unknown as DeviceLogin;
}
export function decodeLoginStatus(data: unknown): LoginStatus {
  const s = requireRecord(data);
  if (!['pending', 'authorized', 'denied', 'expired'].includes(String(s.status))) return invalid();
  return s.status as LoginStatus;
}
