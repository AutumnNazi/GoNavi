import { useI18n } from '../../i18n/provider';
import { useStore, type TitlebarMenuStyle } from '../../store';

import './TitlebarMenuStyleSettings.css';

const TITLEBAR_MENU_STYLE_VALUES: readonly TitlebarMenuStyle[] = ['classic', 'view-menu'];

const styleCopyKey = (value: TitlebarMenuStyle, part: 'label' | 'hint'): string => {
  const name = value === 'view-menu' ? 'view_menu' : 'classic';
  const suffix = part === 'hint' ? '_hint' : '';
  return `app.theme.appearance.titlebar_menu_style.${name}${suffix}`;
};

/**
 * 标题栏两种打开方式：工作区标签是现在的图标入口，视图菜单是勾选显示/隐藏。
 */
export default function TitlebarMenuStyleSettings() {
  const { t } = useI18n();
  const titlebarMenuStyle = useStore((state) => state.appearance.titlebarMenuStyle);
  const setAppearance = useStore((state) => state.setAppearance);

  return (
    <div
      className="gn-titlebar-style-choices"
      role="radiogroup"
      aria-label={t('app.theme.appearance.titlebar_menu_style_title')}
    >
      {TITLEBAR_MENU_STYLE_VALUES.map((value, index) => {
        const active = titlebarMenuStyle === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={`gn-titlebar-style-choice${active ? ' is-active' : ''}`}
            data-titlebar-style={value}
            onClick={() => setAppearance({ titlebarMenuStyle: value })}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
                return;
              }
              event.preventDefault();
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              const next = TITLEBAR_MENU_STYLE_VALUES[
                (index + delta + TITLEBAR_MENU_STYLE_VALUES.length) % TITLEBAR_MENU_STYLE_VALUES.length
              ];
              setAppearance({ titlebarMenuStyle: next });
              const choices = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
              choices?.[TITLEBAR_MENU_STYLE_VALUES.indexOf(next)]?.focus();
            }}
          >
            <span>
              <span className="gn-titlebar-style-name">{t(styleCopyKey(value, 'label'))}</span>
              <span className="gn-titlebar-style-hint">{t(styleCopyKey(value, 'hint'))}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
