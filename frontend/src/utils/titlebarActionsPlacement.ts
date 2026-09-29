/**
 * 「新建连接 / 新建查询 / … / AI」这一行功能入口的摆放位置。
 *
 * - toolbar：标题栏下方独立工具条，图标 + 文字。
 * - titlebar：标题栏 GoNavi 右侧，沿用工具条改版前的标题栏样式。
 */
export type TitlebarActionsPlacement = 'toolbar' | 'titlebar';

/**
 * 放在标题栏时的显示方式；工具条固定为图标 + 文字，不受影响。
 *
 * - text：纯文字（与改版前一致）。
 * - icon：纯图标，名称见悬浮提示。
 * - icon-text：图标 + 精简名称，完整名称见悬浮提示。
 */
export type TitlebarActionsDisplay = 'text' | 'icon' | 'icon-text';

export interface TitlebarActionsPlacementSettings {
  titlebarActionsPlacement: TitlebarActionsPlacement;
  titlebarActionsDisplay: TitlebarActionsDisplay;
}

/**
 * 新用户（本地没有任何配置）的默认值：标题栏 GoNavi 右侧 + 图标 + 精简名称。
 * 首次启动时持久化层拿不到 appearance，直接使用这里的默认外观。
 */
export const DEFAULT_TITLEBAR_ACTIONS_PLACEMENT_SETTINGS: TitlebarActionsPlacementSettings = {
  titlebarActionsPlacement: 'titlebar',
  titlebarActionsDisplay: 'icon-text',
};

/**
 * 老配置缺字段时的回退：保持升级前的独立工具条，避免界面突变；
 * 之后切到标题栏时默认纯文字。
 */
export const LEGACY_TITLEBAR_ACTIONS_PLACEMENT_SETTINGS: TitlebarActionsPlacementSettings = {
  titlebarActionsPlacement: 'toolbar',
  titlebarActionsDisplay: 'text',
};

const sanitizeTitlebarActionsPlacement = (value: unknown): TitlebarActionsPlacement => (
  value === 'toolbar' || value === 'titlebar'
    ? value
    : LEGACY_TITLEBAR_ACTIONS_PLACEMENT_SETTINGS.titlebarActionsPlacement
);

const sanitizeTitlebarActionsDisplay = (value: unknown): TitlebarActionsDisplay => (
  value === 'text' || value === 'icon' || value === 'icon-text'
    ? value
    : LEGACY_TITLEBAR_ACTIONS_PLACEMENT_SETTINGS.titlebarActionsDisplay
);

/** 归一化已持久化的外观：未知值或缺字段按老用户处理，回退到升级前的布局。 */
export const sanitizeTitlebarActionsPlacementSettings = (
  value: Partial<TitlebarActionsPlacementSettings> | undefined,
): TitlebarActionsPlacementSettings => ({
  titlebarActionsPlacement: sanitizeTitlebarActionsPlacement(value?.titlebarActionsPlacement),
  titlebarActionsDisplay: sanitizeTitlebarActionsDisplay(value?.titlebarActionsDisplay),
});
