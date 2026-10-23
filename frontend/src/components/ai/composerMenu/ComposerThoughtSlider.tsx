import React, { useRef, useState } from 'react';

import { isNoThoughtLevel } from './composerMenuModel';
import {
  EFFORT_BUBBLES,
  highspeedBubbles,
  hoveredThoughtLevel,
  thoughtFillWidth,
  thoughtSliderProgress,
  thoughtThumbLeft,
} from './composerThoughtMotion';
import RollingLabel from './RollingLabel';

export interface ThoughtLevel {
  value: string;
  label: string;
}

interface ComposerThoughtSliderProps {
  levels: readonly ThoughtLevel[];
  value: string;
  active: boolean;
  disabled: boolean;
  highspeed: boolean;
  heading: string;
  visualKey: string;
  onChange: (value: string) => void;
}

const SLIDER_KEYS = new Set([
  'Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown',
]);

const ComposerThoughtSlider: React.FC<ComposerThoughtSliderProps> = ({
  levels, value, active, disabled, highspeed, heading, visualKey, onChange,
}) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  if (levels.length === 0) return null;
  const index = levels.findIndex((level) => level.value === value);
  const current = index >= 0 ? levels[index] : undefined;
  const label = active && current ? current.label : '—';
  const atMax = Boolean(current) && index === levels.length - 1 && !isNoThoughtLevel(current?.value || '');
  const filled = active && index >= 0 && !isNoThoughtLevel(levels[index].value);
  const progress = thoughtSliderProgress(levels.length, index, active && filled);
  const thumbProgress = thoughtSliderProgress(levels.length, index, active);
  const sliderDisabled = disabled || !active || levels.length < 2;
  const bubbles = highspeed ? highspeedBubbles() : EFFORT_BUBBLES;

  const selectIndex = (nextIndex: number) => {
    const level = levels[nextIndex];
    if (!sliderDisabled && level && level.value !== value) onChange(level.value);
  };

  return (
    <div className="gn-zcode-effort">
      <div className="gn-zcode-effort-heading">
        <span className="gn-zcode-effort-kicker">{heading}</span>
        <RollingLabel label={label} />
      </div>
      {levels.length < 2 ? null : (
        <div
          className="gn-zcode-thought-slider"
          data-disabled={sliderDisabled}
          onFocus={(event) => {
            if (event.target === event.currentTarget) inputRef.current?.focus();
          }}
        >
          <div key={visualKey} aria-hidden="true" className="gn-zcode-thought-visual">
            <div className="gn-zcode-thought-track" data-testid="composer-thought-track" data-progress={filled ? progress : 0}>
              <div className="gn-zcode-thought-track-border" />
              <div
                className="gn-zcode-thought-fill"
                data-max={filled && atMax}
                data-highspeed={highspeed && active}
                style={{ width: thoughtFillWidth(progress, filled) }}
              >
                {filled && atMax && !sliderDisabled ? (
                  <div className="gn-zcode-thought-bubbles" data-testid="composer-thought-bubbles">
                    {bubbles.map((bubble, bubbleIndex) => (
                      <span
                        key={bubbleIndex}
                        className="gn-zcode-thought-bubble"
                        style={{ top: bubble.top, animationDuration: `${bubble.duration}s`, animationDelay: `${bubble.delay}s` }}
                      >
                        <span style={{ width: bubble.size, height: bubble.size }} />
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="gn-zcode-thought-stops">
              {levels.map((level, stopIndex) => (
                <span
                  key={level.value}
                  className="gn-zcode-thought-stop"
                  data-filled={filled && stopIndex <= index}
                  data-hovered={!sliderDisabled && hovered === level.value}
                />
              ))}
            </div>
            <div className="gn-zcode-thought-thumb" style={{ left: thoughtThumbLeft(thumbProgress) }} />
          </div>
          <input
            ref={inputRef}
            type="range"
            min={0}
            max={Math.max(0, levels.length - 1)}
            step={1}
            value={Math.max(0, index)}
            aria-disabled={sliderDisabled}
            aria-label={heading}
            aria-valuetext={label}
            data-testid="composer-thought-slider"
            className="gn-zcode-thought-range"
            onPointerDown={(event) => {
              if (sliderDisabled) event.preventDefault();
            }}
            onPointerLeave={() => setHovered(null)}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setHovered(hoveredThoughtLevel(event.clientX, rect, levels, sliderDisabled, event.pointerType));
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') {
                event.stopPropagation();
                if (sliderDisabled && event.key !== 'Tab') event.preventDefault();
              }
            }}
            onKeyUp={(event) => {
              if (SLIDER_KEYS.has(event.key)) selectIndex(Number(event.currentTarget.value));
            }}
            onPointerUp={(event) => selectIndex(Number(event.currentTarget.value))}
            onChange={(event) => selectIndex(Number(event.currentTarget.value))}
          />
        </div>
      )}
    </div>
  );
};

export default ComposerThoughtSlider;
