import React from 'react';

import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';

export interface AISettingsChoiceOption<T extends string> {
  value: T;
  title: string;
  description: string;
  icon: React.ReactNode;
}

interface AISettingsChoiceGroupProps<T extends string> {
  ariaLabel: string;
  value: T;
  options: readonly AISettingsChoiceOption<T>[];
  className: string;
  overlayTheme: OverlayWorkbenchTheme;
  cardBorder: string;
  onChange: (value: T) => void;
}

const AISettingsChoiceGroup = <T extends string>({
  ariaLabel,
  value,
  options,
  className,
  overlayTheme,
  cardBorder,
  onChange,
}: AISettingsChoiceGroupProps<T>) => {
  const groupId = React.useId();
  const choiceRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = React.useState<number | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  const moveSelection = (index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex: number | null = null;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (index + 1) % options.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + options.length) % options.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = options.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    onChange(options[nextIndex].value);
    choiceRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        borderTop: `1px solid ${cardBorder}`,
        fontFamily: 'var(--gn-font-sans)',
      }}
    >
      {options.map((option, index) => {
        const active = value === option.value;
        const interactive = hoveredIndex === index || focusedIndex === index;
        const descriptionId = `${groupId}-${option.value}-description`;

        return (
          <button
            key={option.value}
            ref={(node) => {
              choiceRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-describedby={descriptionId}
            tabIndex={index === selectedIndex ? 0 : -1}
            className={`${className}${active ? ' is-active' : ''}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => moveSelection(index, event)}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => setFocusedIndex(null)}
            style={{
              width: '100%',
              minHeight: 'calc(62px * var(--gn-ui-scale, 1))',
              padding: '11px 10px',
              border: 'none',
              borderBottom: `1px solid ${cardBorder}`,
              borderRadius: 0,
              cursor: 'pointer',
              transition: 'background 0.16s ease, outline-color 0.16s ease',
              background: active ? overlayTheme.selectedBg : (interactive ? overlayTheme.hoverBg : 'transparent'),
              display: 'grid',
              gridTemplateColumns: '20px minmax(0, 1fr) 18px',
              alignItems: 'start',
              gap: 12,
              color: 'inherit',
              fontFamily: 'var(--gn-font-sans)',
              textAlign: 'left',
              outline: focusedIndex === index ? `2px solid ${overlayTheme.selectedText}` : '2px solid transparent',
              outlineOffset: -2,
              boxSizing: 'border-box',
              appearance: 'none',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 20,
                height: 20,
                display: 'grid',
                placeItems: 'center',
                fontSize: 'var(--gn-font-size, 14px)',
                lineHeight: '20px',
                color: overlayTheme.mutedText,
                marginTop: 1,
              }}
            >
              {option.icon}
            </span>

            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  color: overlayTheme.titleText,
                  fontFamily: 'var(--gn-font-sans)',
                  fontSize: 'var(--gn-font-size, 14px)',
                  fontWeight: 600,
                  lineHeight: '20px',
                }}
              >
                {option.title}
              </span>
              <span
                id={descriptionId}
                style={{
                  display: 'block',
                  color: overlayTheme.mutedText,
                  fontFamily: 'var(--gn-font-sans)',
                  fontSize: 'var(--gn-font-size-sm, 12px)',
                  fontWeight: 400,
                  lineHeight: '18px',
                  marginTop: 2,
                }}
              >
                {option.description}
              </span>
            </span>

            <span
              aria-hidden="true"
              className="gonavi-ai-choice-indicator"
              style={{
                width: 16,
                height: 16,
                border: `1.5px solid ${active ? overlayTheme.selectedText : cardBorder}`,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                boxSizing: 'border-box',
                marginTop: 2,
              }}
            >
              {active && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: overlayTheme.selectedText,
                  }}
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default AISettingsChoiceGroup;
