export const PREFERENCE_PAGES = ['common-settings', 'layout-settings', 'sidebar-settings', 'tabs-settings', 'editor-settings', 'fonts-settings', 'colors-settings'] as const;
export type PreferencePage = typeof PREFERENCE_PAGES[number];
export const isPreferencePage = (value: string): value is PreferencePage => PREFERENCE_PAGES.some(page => page === value);
export const preferenceTitleKey = (page: PreferencePage) => `settings.page.${page}.title`;
export const preferenceDescriptionKey = (page: PreferencePage) => `settings.page.${page}.description`;
export const OPEN_PREFERENCE_PAGE = 'gonavi:open-preference-page';
export function openPreferencePage(page: PreferencePage) {
  window.dispatchEvent(new CustomEvent(OPEN_PREFERENCE_PAGE, { detail: page }));
}
