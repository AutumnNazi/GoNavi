export interface ThoughtBubble {
  top: number;
  size: number;
  duration: number;
  delay: number;
}

// 固定种子，重渲染不改气泡节奏。数值与 ZCode composer thought slider 一致
// （zai-org/ZCode，Apache-2.0）。
export const EFFORT_BUBBLES: readonly ThoughtBubble[] = [
  { top: 4, size: 2, duration: 2.6, delay: -0.4 },
  { top: 14, size: 3, duration: 3.2, delay: -2.1 },
  { top: 8, size: 4, duration: 2.8, delay: -1.1 },
  { top: 18, size: 2, duration: 3.6, delay: -0.8 },
  { top: 3, size: 3, duration: 3, delay: -2.5 },
  { top: 12, size: 2, duration: 3.4, delay: -1.7 },
  { top: 6, size: 3, duration: 3.1, delay: -0.9 },
  { top: 17, size: 4, duration: 2.9, delay: -2.3 },
  { top: 10, size: 2, duration: 3.5, delay: -0.2 },
  { top: 2, size: 2, duration: 2.7, delay: -1.8 },
  { top: 15, size: 3, duration: 3.3, delay: -1.2 },
  { top: 7, size: 4, duration: 3.6, delay: -3.1 },
];

export const highspeedBubbles = (): ThoughtBubble[] => Array.from({ length: 32 }, (_, index) => ({
  ...EFFORT_BUBBLES[index % EFFORT_BUBBLES.length],
  duration: (8 + (index % 5)) / 10,
  delay: -index * 0.137,
}));

export const thoughtSliderProgress = (
  count: number,
  index: number,
  active: boolean,
): number => (active && count > 1 && index >= 0 ? (index / (count - 1)) * 100 : 0);

export const thoughtFillWidth = (progress: number, filled: boolean): string => (
  filled ? `calc(14px + (100% - 28px) * ${progress / 100})` : '0'
);

export const thoughtThumbLeft = (progress: number): string => (
  `calc((100% - 28px) * ${progress / 100})`
);

export const hoveredThoughtLevel = (
  clientX: number,
  rect: { left: number; width: number },
  levels: readonly { value: string }[],
  disabled: boolean,
  pointerType: string,
): string | null => {
  if (disabled || pointerType === 'touch' || levels.length < 2 || rect.width <= 28) return null;
  const trackWidth = rect.width - 28;
  const index = Math.round(((clientX - rect.left - 14) / trackWidth) * (levels.length - 1));
  const level = levels[index];
  if (!level) return null;
  const center = rect.left + 14 + (trackWidth * index) / (levels.length - 1);
  return Math.abs(clientX - center) <= 10 ? level.value : null;
};
