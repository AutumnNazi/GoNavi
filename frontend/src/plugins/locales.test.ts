import { describe, expect, it } from 'vitest';
import { catalogs } from '../i18n/catalog';
import { PLUGIN_ERROR_CODES } from './apiResult';

describe('plugin locale parity', () => {
  it('translates every plugin key in all six catalogs with matching interpolation', () => {
    const english = catalogs['en-US'];
    const keys = Object.keys(english).filter((key) => key.startsWith('plugin.'));
    expect(keys.length).toBeGreaterThanOrEqual(100);
    for (const [locale, catalog] of Object.entries(catalogs)) {
      const strings = catalog as Record<string, string>;
      expect(Object.keys(strings).filter((key) => key.startsWith('plugin.')).sort(), locale).toEqual(keys.sort());
      for (const key of keys) {
        expect(strings[key]?.length, locale + ':' + key).toBeGreaterThan(0);
        expect(strings[key].match(/{{[^}]+}}/g) ?? [], locale + ':' + key).toEqual((english as Record<string, string>)[key].match(/{{[^}]+}}/g) ?? []);
      }
    }
  });
  it('provides safe backend errors without untrusted interpolation', () => {
    for (const catalog of Object.values(catalogs)) {
      for (const suffix of PLUGIN_ERROR_CODES) {
        const value = (catalog as Record<string, string>)['plugin.backend.error.' + suffix];
        expect(value).toBeTruthy(); expect(value).not.toContain('{{');
      }
    }
  });
});
