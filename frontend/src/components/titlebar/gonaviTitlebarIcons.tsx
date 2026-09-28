/**
 * 标题栏功能工具条的手写 SVG 图标集。
 *
 * 不用 @ant-design/icons 的原因：参考稿里的图标是约 2.4px 粗描边的圆润风格，
 * antd outlined 图标描边只有约 1px，直接引用会和参考稿明显不一致。
 *
 * 所有图标共用 24x24 视口与同一套配色，颜色集中在 GONAVI_TITLEBAR_ICON_COLORS，
 * 便于后续按主题统一调整；填充色走 currentColor 的图标只用于单色场景。
 */

/** 参考稿取色，集中在一处便于主题化。 */
export const GONAVI_TITLEBAR_ICON_COLORS = {
  /** 工具条主体的蓝（插头、表格、数据库柱体、SQL 方块） */
  blue: '#3b82f6',
  /** 表格网格线的浅蓝 */
  blueSoft: '#7fb0f7',
  /** 新增角标绿 */
  green: '#3bb54a',
  /** 节点图的靛蓝 */
  indigo: '#6366f1',
  /** 节点图最上方节点的亮蓝 */
  skyBlue: '#4b9bff',
  /** 驱动管理齿轮 / 关于圆形的紫 */
  purple: '#4c3fd6',
  /** 激活块底色（淡紫） */
  activeSurface: '#eeebff',
} as const;

export interface GonaviTitlebarIconProps {
  /** 渲染边长，默认由 CSS 变量 --gn-toolbar-icon-size 控制。 */
  size?: number | string;
  className?: string;
}

const resolveSize = (size?: number | string): number | string => size ?? '100%';

/** 插头（新建连接）：斜置插头本体 + 左下引线 + 右下绿色加号角标。 */
export function TitlebarPlugIcon({ size, className }: GonaviTitlebarIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* 左下引线 */}
      <path
        d="M7.6 16.4 3.6 20.4"
        stroke={GONAVI_TITLEBAR_ICON_COLORS.blue}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      {/* 插头本体 */}
      <path
        d="M8.4 14.2c-.9-.9-.9-2.3 0-3.2l4.3-4.3c.9-.9 2.3-.9 3.2 0l3.4 3.4c.9.9.9 2.3 0 3.2l-4.3 4.3c-.9.9-2.3.9-3.2 0z"
        fill={GONAVI_TITLEBAR_ICON_COLORS.blue}
      />
      {/* 插脚 */}
      <path
        d="M15.9 3.7 17.6 2m1.9 3.8L21.2 4"
        stroke={GONAVI_TITLEBAR_ICON_COLORS.blue}
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      {/* 加号角标 */}
      <circle cx="18.4" cy="18.4" r="4.4" fill={GONAVI_TITLEBAR_ICON_COLORS.green} />
      <path
        d="M18.4 16.4v4m-2-2h4"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 表格（新建查询）：顶行与左列实心、右下留空的网格，带绿色加号角标。 */
export function TitlebarGridIcon({ size, className }: GonaviTitlebarIconProps) {
  const soft = GONAVI_TITLEBAR_ICON_COLORS.blueSoft;
  const blue = GONAVI_TITLEBAR_ICON_COLORS.blue;
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* 表头行 */}
      <rect x="2.6" y="3.4" width="18.8" height="5.2" fill={blue} />
      {/* 表头列 */}
      <rect x="2.6" y="3.4" width="5.4" height="14.6" fill={blue} />
      {/* 其余单元格：浅蓝描边 */}
      <g fill={soft}>
        <rect x="9.6" y="10.2" width="5" height="3.2" />
        <rect x="16.2" y="10.2" width="5.2" height="3.2" />
        <rect x="9.6" y="15" width="5" height="3" />
        <rect x="16.2" y="15" width="5.2" height="3" />
      </g>
      {/* 加号角标 */}
      <circle cx="18.6" cy="18.4" r="4.4" fill={GONAVI_TITLEBAR_ICON_COLORS.green} />
      <path
        d="M18.6 16.4v4m-2-2h4"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 数据库柱体（管理连接分组）：三层堆叠的圆柱。 */
export function TitlebarDatabaseIcon({ size, className }: GonaviTitlebarIconProps) {
  const blue = GONAVI_TITLEBAR_ICON_COLORS.blue;
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* 顶层：完整椭圆 + 柱身 */}
      <path
        d="M12 2.4c4 0 7.2 1.3 7.2 2.9v3.2c0 1.6-3.2 2.9-7.2 2.9S4.8 10.1 4.8 8.5V5.3c0-1.6 3.2-2.9 7.2-2.9z"
        fill={blue}
      />
      {/* 中段 */}
      <path
        d="M4.8 12.2c1.4 1.1 4.1 1.8 7.2 1.8s5.8-.7 7.2-1.8v3.4c0 1.6-3.2 2.9-7.2 2.9s-7.2-1.3-7.2-2.9z"
        fill={blue}
      />
      {/* 底段 */}
      <path
        d="M4.8 17.6c1.4 1.1 4.1 1.8 7.2 1.8s5.8-.7 7.2-1.8v2.5c0 1.6-3.2 2.9-7.2 2.9s-7.2-1.3-7.2-2.9z"
        fill={blue}
      />
      {/* 分段之间留白 */}
      <path d="M4.8 11.3c1.4 1.1 4.1 1.8 7.2 1.8s5.8-.7 7.2-1.8" stroke="#fff" strokeWidth="1.1" fill="none" />
      <path d="M4.8 16.7c1.4 1.1 4.1 1.8 7.2 1.8s5.8-.7 7.2-1.8" stroke="#fff" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

/** 节点图（数据工作流）：三个实心圆由直线连接。 */
export function TitlebarGraphIcon({ size, className }: GonaviTitlebarIconProps) {
  const indigo = GONAVI_TITLEBAR_ICON_COLORS.indigo;
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* 连线先画，节点覆盖在上层 */}
      <path
        d="M11.4 6.6 8.2 16.4m5.4-9.4 4 9m-8.4-.2 6.6.2"
        stroke={indigo}
        strokeWidth="1.6"
        fill="none"
      />
      <circle cx="12" cy="5.2" r="2.9" fill={GONAVI_TITLEBAR_ICON_COLORS.skyBlue} />
      <circle cx="7.2" cy="17.6" r="2.9" fill={GONAVI_TITLEBAR_ICON_COLORS.blue} />
      <circle cx="17.8" cy="16.8" r="2.9" fill={indigo} />
    </svg>
  );
}

/** 终端方块（SQL 工具）：蓝色圆角方块内白色提示符。 */
export function TitlebarSqlToolIcon({ size, className }: GonaviTitlebarIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2.2"
        y="4.2"
        width="19.6"
        height="15.6"
        rx="3.2"
        fill={GONAVI_TITLEBAR_ICON_COLORS.blue}
      />
      <path
        d="M6.8 9.4 9.6 12l-2.8 2.6"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M11.8 15.4h4.6"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 齿轮（驱动管理）：以中心圆孔 + 8 齿径向块绘制。
 * 用路径而不是文字字形，保证在 22-24px 下齿形不糊。
 */
export function TitlebarGearIcon({ size, className }: GonaviTitlebarIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10.0 2.3h4l.5 2.5 2 1.1 2.4-.9 2 3.5-1.9 1.6v2.3l1.9 1.6-2 3.5-2.4-.9-2 1.1-.5 2.5h-4l-.5-2.5-2-1.1-2.4.9-2-3.5 1.9-1.6v-2.3L3.1 8.5l2-3.5 2.4.9 2-1.1z"
        fill={GONAVI_TITLEBAR_ICON_COLORS.purple}
      />
      <circle cx="12" cy="12" r="3.5" fill="#fff" />
    </svg>
  );
}

/** 关于：紫色实心圆 + 白色 i。 */
export function TitlebarInfoIcon({ size, className }: GonaviTitlebarIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9.8" fill={GONAVI_TITLEBAR_ICON_COLORS.purple} />
      <circle cx="12" cy="7.4" r="1.5" fill="#fff" />
      <rect x="10.9" y="10.2" width="2.2" height="7.2" rx="1.1" fill="#fff" />
    </svg>
  );
}

/** 主题：太阳（实心圆 + 8 条射线）。胶囊「主题」段使用。 */
export function TitlebarSunIcon({ size, className }: GonaviTitlebarIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="4.6" fill="none" stroke="currentColor" strokeWidth="2.1" />
      <g stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
        <path d="M12 1.9v2.6M12 19.5v2.6M1.9 12h2.6M19.5 12h2.6" />
        <path d="M4.9 4.9 6.7 6.7M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
      </g>
    </svg>
  );
}

/** 齿轮轮廓版（描边），胶囊「偏好设置」段使用。 */
export function TitlebarSettingsIcon({ size, className }: GonaviTitlebarIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10.0 2.3h4l.5 2.5 2 1.1 2.4-.9 2 3.5-1.9 1.6v2.3l1.9 1.6-2 3.5-2.4-.9-2 1.1-.5 2.5h-4l-.5-2.5-2-1.1-2.4.9-2-3.5 1.9-1.6v-2.3L3.1 8.5l2-3.5 2.4.9 2-1.1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** AI 助手：主四角星 + 右上小辅星，走 currentColor 跟随按钮文字色。 */
export function TitlebarSparkIcon({ size, className }: GonaviTitlebarIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M11.4 3.2 12.9 8.1 17.8 9.6 12.9 11.1 11.4 16 9.9 11.1 5 9.6 9.9 8.1Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M18.1 14.4 18.85 16.75 21.2 17.5 18.85 18.25 18.1 20.6 17.35 18.25 15 17.5 17.35 16.75Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** AI（工具条彩色版）：紫色主星 + 天蓝辅星，与相邻的彩色图标同一套取色。 */
export function TitlebarSparkColorIcon({ size, className }: GonaviTitlebarIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={resolveSize(size)}
      height={resolveSize(size)}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M11.4 3.2 12.9 8.1 17.8 9.6 12.9 11.1 11.4 16 9.9 11.1 5 9.6 9.9 8.1Z"
        fill={GONAVI_TITLEBAR_ICON_COLORS.purple}
        stroke={GONAVI_TITLEBAR_ICON_COLORS.purple}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M18.1 14.4 18.85 16.75 21.2 17.5 18.85 18.25 18.1 20.6 17.35 18.25 15 17.5 17.35 16.75Z"
        fill={GONAVI_TITLEBAR_ICON_COLORS.skyBlue}
        stroke={GONAVI_TITLEBAR_ICON_COLORS.skyBlue}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
