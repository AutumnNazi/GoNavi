import { useState } from 'react';
import { Button } from 'antd';
import { useStore } from '../../../store';
import { useOptionalI18n } from '../../../i18n/provider';
import { t as defaultTranslate } from '../../../i18n';
import { toggleFavoriteSetting, DEFAULT_FAVORITE_SETTINGS } from '../../../utils/favoriteSettings';
import { FavoriteSettingsManager } from './FavoriteSettingsManager';
import { findFavoriteSetting, openFavoriteSetting } from './favoriteSettingsCatalog';
import { PreferenceControls } from './PreferenceControls';

export function FavoriteSettings() {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const ids = useStore(state => state.appearance.favoriteSettings ?? DEFAULT_FAVORITE_SETTINGS);
  const setAppearance = useStore(state => state.setAppearance);
  const [editing, setEditing] = useState(false);
  const settings = ids.flatMap(id => { const item = findFavoriteSetting(id); return item ? [item] : []; });
  const tableItems = settings.filter(item => item.control && ['density', 'rows', 'borders'].includes(item.control));
  const lastTableId = tableItems[tableItems.length - 1]?.id;
  return <>
    <div className="gn-favorites-toolbar"><span>{t('settings.favorites.count', { count: settings.length })}</span>
      <Button onClick={() => setEditing(!editing)}>{t(editing ? 'settings.favorites.done' : 'settings.favorites.manage')}</Button></div>
    {editing && <FavoriteSettingsManager />}
    {!editing && !settings.length && <div className="gn-favorites-empty"><h3>{t('settings.favorites.empty')}</h3><p>{t('settings.favorites.help')}</p>
      <Button onClick={() => setEditing(true)}>{t('settings.favorites.manage')}</Button></div>}
    {!editing && <div className="gn-favorites-list">
      {settings.map(item => item.control ? <PreferenceControls collapsiblePreviews key={item.id} controls={[item.control]} tablePreview={item.id === lastTableId} /> : (
        <div className="gn-favorite-link-row" key={item.id}>
          <button className="gn-favorite-link" type="button" onClick={() => openFavoriteSetting(item.id)}><span>{t(item.labelKey)}{item.categoryKey && <em className="gn-favorite-category">{t(item.categoryKey)}</em>}</span><small>{t('settings.favorites.open')}</small></button>
          <button className="gn-preference-pin is-pinned" type="button" aria-label={t('settings.favorites.remove_label', { name: t(item.labelKey) })}
            onClick={() => setAppearance({ favoriteSettings: toggleFavoriteSetting(ids, item.id) })}>★</button>
        </div>
      ))}
    </div>}
  </>;
}
