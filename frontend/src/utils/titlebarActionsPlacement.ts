/**
 * 「新建连接 / 新建查询 / … / AI」这一行功能入口的摆放位置。
 *
 * - toolbar：标题栏下方独立工具条，图标 + 文字（默认）。
 * - titlebar：标题栏 GoNavi 右侧，纯文字，沿用工具条改版前的标题栏样式。
 */
export type TitlebarActionsPlacement = 'toolbar' | 'titlebar';

export const TITLEBAR_ACTIONS_PLACEMENTS: readonly TitlebarActionsPlacement[] = ['toolbar', 'titlebar'];

export interface TitlebarActionsPlacementSettings {
  titlebarActionsPlacement: TitlebarActionsPlacement;
}

export const DEFAULT_TITLEBAR_ACTIONS_PLACEMENT_SETTINGS: TitlebarActionsPlacementSettings = {
  titlebarActionsPlacement: 'toolbar',
};

/** 老配置没有该字段、或写入了未知值时回到工具条，避免升级后界面突变。 */
export const sanitizeTitlebarActionsPlacementSettings = (
  value: Partial<TitlebarActionsPlacementSettings> | undefined,
): TitlebarActionsPlacementSettings => ({
  titlebarActionsPlacement: value?.titlebarActionsPlacement === 'titlebar'
    ? 'titlebar'
    : DEFAULT_TITLEBAR_ACTIONS_PLACEMENT_SETTINGS.titlebarActionsPlacement,
});
