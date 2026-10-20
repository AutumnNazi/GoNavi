import { defineSettingsCenterPageEntries as page, type SettingsCenterSearchEntry } from '../settingsCenterSearchEntries';

/** Settings inside the 服务配置 pages except AI (see ai.ts). */
export const SERVICES_SEARCH_ENTRIES: ReadonlyArray<SettingsCenterSearchEntry> = [
  ...page('services', 'proxy', [
    'app.proxy.type',
    'app.proxy.host',
    'app.proxy.port',
    'app.proxy.username_optional',
    'app.proxy.password_optional',
    'app.proxy.clear_saved_password',
    'app.proxy.test.target_label',
    'app.proxy.test.action',
    'app.proxy.apply',
    'app.proxy.reset',
  ]).map((entry) => (
    entry.labelKey === 'app.proxy.type'
      ? { ...entry, aliasKeys: ['app.proxy.type_socks5', 'app.proxy.type_http'] }
      : entry
  )),

  ...page('services', 'web-auth', [
    'app.settings.web_auth.password.title',
    'app.settings.web_auth.password.current_label',
    'app.settings.web_auth.password.code_label',
    'app.settings.web_auth.password.new_label',
    'app.settings.web_auth.password.confirm_label',
    'app.settings.web_auth.password.submit',
    'app.settings.web_auth.status.auth_required',
    'app.settings.web_auth.status.two_factor',
    'app.settings.web_auth.status.recovery_codes',
    'app.settings.web_auth.status.idle_timeout',
    'app.settings.web_auth.status.absolute_timeout',
    'app.settings.web_auth.status.remember_days',
  ]),
];
