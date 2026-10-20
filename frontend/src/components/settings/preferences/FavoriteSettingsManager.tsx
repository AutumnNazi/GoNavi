import { useState } from 'react';
import { Checkbox, Input } from 'antd';
import { useStore } from '../../../store';
import { useOptionalI18n } from '../../../i18n/provider';
import { t as defaultTranslate } from '../../../i18n';
import { moveFavoriteSetting, toggleFavoriteSetting, DEFAULT_FAVORITE_SETTINGS } from '../../../utils/favoriteSettings';
import { FAVORITE_SETTINGS_CATALOG } from './favoriteSettingsCatalog';

export function FavoriteSettingsManager() {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const selected = useStore(state => state.appearance.favoriteSettings ?? DEFAULT_FAVORITE_SETTINGS);
  const setAppearance = useStore(state => state.setAppearance);
  const [query, setQuery] = useState('');
  const settings = [...FAVORITE_SETTINGS_CATALOG].sort((a, b) => {
    const left = selected.indexOf(a.id); const right = selected.indexOf(b.id);
    return (left < 0 ? Infinity : left) - (right < 0 ? Infinity : right);
  }).filter(item => t(item.labelKey).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="gn-favorite-manager" aria-label={t('settings.favorites.manage')}>
    <div className="gn-favorite-manager-heading"><div><h3>{t('settings.favorites.manage')}</h3><p>{t('settings.favorites.help')}</p></div>
</div>
    <Input allowClear aria-label={t('settings.favorites.search')} placeholder={t('settings.favorites.search')} value={query} onChange={event => setQuery(event.target.value)} />
    <div className="gn-favorite-manager-list">
      {settings.map(item => {
        const index = selected.indexOf(item.id);
        return <div className="gn-favorite-choice" key={item.id}>
          <Checkbox checked={index >= 0} onChange={() => setAppearance({ favoriteSettings: toggleFavoriteSetting(selected, item.id) })}>{t(item.labelKey)}{item.categoryKey && <small className="gn-favorite-category">{t(item.categoryKey)}</small>}</Checkbox>
          <span className="gn-favorite-choice-actions">
            {index >= 0 && <><button type="button" disabled={index === 0} aria-label={t('settings.favorites.move_up', { name: t(item.labelKey) })} onClick={() => setAppearance({ favoriteSettings: moveFavoriteSetting(selected, item.id, -1) })}>↑</button>
              <button type="button" disabled={index === selected.length - 1} aria-label={t('settings.favorites.move_down', { name: t(item.labelKey) })} onClick={() => setAppearance({ favoriteSettings: moveFavoriteSetting(selected, item.id, 1) })}>↓</button></>}
          </span>
        </div>;
      })}
      {!settings.length && <p>{t('settings.favorites.no_results')}</p>}
    </div>
  </section>;
}
