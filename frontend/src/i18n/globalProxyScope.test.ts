import { describe, expect, it } from 'vitest';

import { catalogs } from './catalog';

const expectedDatabaseBoundaries = {
  'de-DE': {
    description: 'Datenbankverbindungen verwenden nur ihre eigenen Proxy-Einstellungen',
    scope: 'Datenbankverbindungen sind nicht betroffen',
  },
  'en-US': {
    description: 'Database connections only use their own proxy settings',
    scope: 'does not affect database connections',
  },
  'ja-JP': {
    description: 'データベース接続では接続ごとのプロキシ設定のみを使用します',
    scope: 'データベース接続には影響しません',
  },
  'ru-RU': {
    description: 'Подключения к базе данных используют только собственные настройки прокси',
    scope: 'не влияет на подключения к базе данных',
  },
  'zh-CN': {
    description: '数据库连接仅使用连接自身的代理配置',
    scope: '不影响数据库连接',
  },
  'zh-TW': {
    description: '資料庫連線僅使用連線本身的代理設定',
    scope: '不影響資料庫連線',
  },
} as const;

describe('global proxy scope copy', () => {
  it('makes the database proxy boundary explicit in every locale', () => {
    for (const [language, expected] of Object.entries(expectedDatabaseBoundaries)) {
      const catalog = catalogs[language as keyof typeof catalogs];

      expect(catalog['app.proxy.description']).toContain(expected.description);
      expect(catalog['app.proxy.scope_hint']).toContain(expected.scope);
    }
  });
});
