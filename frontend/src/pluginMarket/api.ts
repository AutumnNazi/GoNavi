import {
  PluginMarketSettings, PluginMarketConfigure, PluginMarketCatalog, PluginMarketDetail,
  PluginMarketRatings, PluginMarketRate, PluginMarketDeleteRating, PluginMarketLogin,
  PluginMarketPollLogin, PluginMarketLogout, PluginMarketInstall, PluginMarketInspect, PluginMarketCancelInspection,
} from '../../wailsjs/go/app/App';
import { pluginResult, ignoreResult } from '../plugins/apiResult';
import { isRecord } from '../plugins/jsonBoundary';
import { decodeSettings, decodeMarketPlugin, decodeRatings, decodeRating, decodeLogin, decodeLoginStatus } from './decode';
import type { MarketSort } from './types';
import { marketCatalogResult } from './catalogResult';
import { marketInstallResult } from './installResult';
import { decodeInspectionQuote } from './inspectionQuote';

export const marketAPI = {
  settings: () => pluginResult(PluginMarketSettings(), decodeSettings),
  configure: (url: string) => pluginResult(PluginMarketConfigure(url), decodeSettings),
  catalog: (query: string, sort: MarketSort, cursor: string) => marketCatalogResult(PluginMarketCatalog(query, sort, cursor)),
  detail: (id: string) => pluginResult(PluginMarketDetail(id), decodeMarketPlugin),
  ratings: (id: string) => pluginResult(PluginMarketRatings(id), decodeRatings),
  rate: (id: string, stars: number, body: string, version: string) => pluginResult(PluginMarketRate(id, stars, body, version), decodeRating),
  deleteRating: (id: string) => pluginResult(PluginMarketDeleteRating(id), ignoreResult),
  login: () => pluginResult(PluginMarketLogin(), decodeLogin),
  pollLogin: (code: string) => pluginResult(PluginMarketPollLogin(code), decodeLoginStatus),
  logout: () => pluginResult(PluginMarketLogout(), ignoreResult),
  inspect: async (id: string, version: string, artifactDigest: string, sourceId: string) => {
    const data = await pluginResult(PluginMarketInspect(id, version, artifactDigest, sourceId), (value) => value);
    try { return decodeInspectionQuote(data); }
    catch (cause) {
      const token = isRecord(data) ? data.approvalToken : undefined;
      if (typeof token === 'string' && token.length > 0 && token.length <= 1024) {
        void Promise.resolve().then(() => PluginMarketCancelInspection(token)).catch(() => undefined);
      }
      throw cause;
    }
  },
  cancelInspection: (approvalToken: string) => pluginResult(PluginMarketCancelInspection(approvalToken), ignoreResult),
  install: (id: string, version: string, digest: string, trusted: boolean, approvalToken: string) => marketInstallResult(PluginMarketInstall(id, version, digest, trusted, approvalToken)),
};
