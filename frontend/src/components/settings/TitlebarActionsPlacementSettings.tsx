import { useI18n } from '../../i18n/provider';
import { useStore } from '../../store';
import type { TitlebarActionsPlacement } from '../../utils/titlebarActionsPlacement';

/**
 * 功能入口位置：独立工具条（图标 + 文字）或标题栏 GoNavi 右侧（纯文字）。
 * 外观与「新版左侧搜索模式」一致，用分段按钮即时切换。
 */
export default function TitlebarActionsPlacementSettings() {
  const { t } = useI18n();
  const placement = useStore((state) => state.appearance.titlebarActionsPlacement);
  const setAppearance = useStore((state) => state.setAppearance);
  const options: { value: TitlebarActionsPlacement; label: string }[] = [
    { value: 'toolbar', label: t('app.theme.titlebar_actions_placement.toolbar') },
    { value: 'titlebar', label: t('app.theme.titlebar_actions_placement.titlebar') },
  ];

  return (
    <div
      className="gonavi-settings-pills"
      role="group"
      aria-label={t('app.theme.titlebar_actions_placement.title')}
      data-titlebar-actions-placement-settings="true"
    >
      {options.map((option) => {
        const active = placement === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={`gonavi-settings-pill${active ? ' is-active' : ''}`}
            aria-pressed={active}
            data-titlebar-actions-placement={option.value}
            onClick={() => setAppearance({ titlebarActionsPlacement: option.value })}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
