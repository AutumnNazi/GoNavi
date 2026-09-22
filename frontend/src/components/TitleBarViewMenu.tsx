import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown } from 'antd';

import { useSqlExecutionLogOpen } from '../utils/sqlExecutionLogVisibility';
import {
  isTitleBarViewMenuToggle,
  type TitleBarViewMenuEntry,
  type TitleBarViewMenuToggle,
} from './titleBarViewMenuModel';
import './TitleBarViewMenu.css';

export type { TitleBarViewMenuEntry } from './titleBarViewMenuModel';

interface TitleBarViewMenuProps {
  label: string;
  entries: TitleBarViewMenuEntry[];
}

const MenuCheck = () => (
  <svg className="gn-view-menu-check" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M3.5 8.2 6.4 11.1 12.5 4.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const nextEnabledIndex = (entries: TitleBarViewMenuEntry[], start: number, delta: number): number => {
  const count = entries.length;
  if (count === 0) {
    return -1;
  }
  for (let step = 1; step <= count; step += 1) {
    const index = (start + delta * step + count) % count;
    const entry = entries[index];
    if (isTitleBarViewMenuToggle(entry) && !entry.disabled) {
      return index;
    }
  }
  return -1;
};

const focusMenuItem = (node: HTMLButtonElement | null | undefined) => {
  if (typeof node?.focus === 'function') {
    node.focus();
  }
};

const TitleBarViewMenuPanel: React.FC<{
  entries: TitleBarViewMenuEntry[];
  onActivate: (entry: TitleBarViewMenuToggle) => void;
}> = ({ entries, onActivate }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const node = menuRef.current;
    if (typeof node?.focus === 'function') {
      node.focus();
    }
  }, []);

  const moveFocus = (current: number, delta: number) => {
    focusMenuItem(itemRefs.current[nextEnabledIndex(entries, current, delta)]);
  };

  return (
    <div
      ref={menuRef}
      className="gn-view-menu"
      role="menu"
      tabIndex={-1}
      data-titlebar-view-menu-panel="true"
      data-no-titlebar-toggle="true"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
          return;
        }
        if (event.target !== event.currentTarget) {
          return;
        }
        event.preventDefault();
        moveFocus(event.key === 'ArrowDown' ? -1 : 0, event.key === 'ArrowDown' ? 1 : -1);
      }}
    >
      {entries.map((entry, index) => {
        if (!isTitleBarViewMenuToggle(entry)) {
          return <div key={entry.key} className="gn-view-menu-separator" role="separator" />;
        }
        return (
          <button
            key={entry.key}
            ref={(node) => { itemRefs.current[index] = node; }}
            type="button"
            role="menuitemcheckbox"
            className="gn-view-menu-item"
            data-view-menu-key={entry.key}
            aria-checked={entry.checked}
            aria-disabled={entry.disabled || undefined}
            title={entry.title}
            onClick={() => {
              if (!entry.disabled) {
                onActivate(entry);
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              moveFocus(index, event.key === 'ArrowDown' ? 1 : -1);
            }}
          >
            <span className="gn-view-menu-check-slot">
              {entry.checked ? <MenuCheck /> : null}
            </span>
            <span className="gn-view-menu-label">{entry.label}</span>
            <span className="gn-view-menu-shortcut">{entry.shortcut ?? ''}</span>
          </button>
        );
      })}
    </div>
  );
};

const TitleBarViewMenu: React.FC<TitleBarViewMenuProps> = ({ label, entries }) => {
  const [open, setOpen] = useState(false);
  const sqlLogOpen = useSqlExecutionLogOpen();
  const menuEntries = useMemo(
    () => entries.map((entry) => (
      entry.kind === 'toggle' && entry.key === 'view-sql-log'
        ? { ...entry, checked: !entry.disabled && sqlLogOpen }
        : entry
    )),
    [entries, sqlLogOpen],
  );

  const handleActivate = useCallback((entry: TitleBarViewMenuToggle) => {
    setOpen(false);
    entry.onClick();
  }, []);

  return (
    <Dropdown
      menu={{ items: [] }}
      trigger={['click']}
      placement="bottomLeft"
      align={{ offset: [0, 4] }}
      transitionName=""
      open={open}
      onOpenChange={setOpen}
      rootClassName="gn-view-menu-dropdown"
      popupRender={() => (
        <TitleBarViewMenuPanel entries={menuEntries} onActivate={handleActivate} />
      )}
    >
      <button
        type="button"
        className={`gn-view-menu-trigger${open ? ' is-open' : ''}`}
        data-titlebar-view-menu="true"
        data-no-titlebar-toggle="true"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onDoubleClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {label}
      </button>
    </Dropdown>
  );
};

export default TitleBarViewMenu;
