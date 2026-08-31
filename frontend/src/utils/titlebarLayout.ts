export type TitleBarLayout = {
  height: number;
  actionHeight: number;
  dividerHeight: number;
  emptyWorkbenchTopOffset: number;
};

const MIN_UI_SCALE = 0.8;
const MAX_UI_SCALE = 1.25;

const resolveUiScale = (uiScale: number): number => {
  const parsed = Number(uiScale);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, parsed));
};

/** Keep the normal titlebar compact; only reserve a second band for docked collapsed-sidebar actions. */
export const resolveTitleBarLayout = (
  uiScale: number,
  isV2Ui: boolean,
  reserveCollapsedActionBand = false,
): TitleBarLayout => {
  const scale = resolveUiScale(uiScale);
  const compactLayout = {
    height: Math.max(28, Math.round(32 * scale)),
    actionHeight: Math.max(24, Math.round(26 * scale)),
    dividerHeight: Math.max(10, Math.round(12 * scale)),
    emptyWorkbenchTopOffset: 0,
  };

  if (!isV2Ui || !reserveCollapsedActionBand) {
    return compactLayout;
  }

  // macOS keeps the native controls and the first titlebar row centred at 16px.
  // Reserve a full second row below it even at the smallest supported UI scale.
  const upperBandBottom = 16 + (Math.max(26, compactLayout.actionHeight) / 2);
  const collapsedActionBandHeight = 26 * scale;
  const minimumTwoBandHeight = Math.ceil(
    upperBandBottom
    + 1 // visual separation between the rows
    + collapsedActionBandHeight
    + 1, // bottom inset used by the docked toolbar
  );

  const height = Math.max(Math.round(56 * scale), minimumTwoBandHeight);
  return {
    ...compactLayout,
    height,
    // The empty landing page already reserves enough room above its heading.
    // Let it overlap this extra band so collapsing the explorer does not move
    // the whole workbench down; regular tab content still starts below it.
    emptyWorkbenchTopOffset: height - compactLayout.height,
  };
};
