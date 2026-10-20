export interface BackgroundImagePosition {
  positionX: number;
  positionY: number;
}

// Offsets are percentages of the viewport, not percentages of image overflow.
export const normalizeBackgroundOffset = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(-100, value)) * 10) / 10 : 0
);

export const normalizeBackgroundPosition = (x: unknown, y: unknown): BackgroundImagePosition => ({
  positionX: normalizeBackgroundOffset(x),
  positionY: normalizeBackgroundOffset(y),
});
