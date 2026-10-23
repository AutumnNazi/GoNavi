import type { PluginInspection, PluginManifest } from '../plugins/types';
export interface MarketArtifact { url: string; sha256: string; sizeBytes: number; platform: string; version: string }
export interface MarketPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  publisherId: string;
  official: boolean;
  version: string;
  category?: string;
  minHostVersion?: string;
  platforms: string[];
  ratingAverage: number;
  ratingCount: number;
  downloadCount: number;
  updatedAt: string;
  manifest?: PluginManifest;
  artifact?: MarketArtifact;
  sourceId?: string;
}
export interface CatalogPage { items: MarketPlugin[]; nextCursor?: string; stale?: boolean; error?: string; cachedAt?: string; sourceId?: string }
export interface MarketRating { userId: string; pluginId: string; stars: number; body: string; version: string; updatedAt: string }
export interface MarketSettings { baseUrl: string; authenticated: boolean; sourceId?: string; trustedOfficial?: boolean }
export interface DeviceLogin { verificationUri: string; userCode: string; deviceCode: string; intervalSeconds: number; expiresIn: number }
export type LoginStatus = 'pending' | 'authorized' | 'denied' | 'expired';
export type MarketSort = 'updated' | 'rating' | 'downloads';
export interface MarketInspectionRequest { id: string; version: string; artifactDigest: string; sourceId: string }
export interface MarketInspectionQuote {
  inspection: PluginInspection;
  sourceId: string;
  artifactDigest: string;
  approvalToken: string;
  expiresAt: string;
}
