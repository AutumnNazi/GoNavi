import React from 'react';

export interface V2ActionMenuPopupProps {
  title: React.ReactNode;
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

const V2ActionMenuPopup: React.FC<V2ActionMenuPopupProps> = ({
  title,
  meta,
  icon,
  badge,
  children,
}) => (
  <div className="gn-v2-action-menu-surface">
    <div className="gn-v2-context-menu-header gn-v2-action-menu-header">
      <span className="gn-v2-context-menu-table-icon gn-v2-action-menu-header-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="gn-v2-context-menu-heading">
        <strong>{title}</strong>
        {meta ? <small>{meta}</small> : null}
      </span>
      {badge ? <span className="gn-v2-context-menu-engine-pill">{badge}</span> : null}
    </div>
    <div className="gn-v2-action-menu-body">{children}</div>
  </div>
);

export const renderV2ActionMenuPopup = (
  menu: React.ReactNode,
  enabled: boolean,
  props: Omit<V2ActionMenuPopupProps, 'children'>,
): React.ReactNode => (
  enabled ? <V2ActionMenuPopup {...props}>{menu}</V2ActionMenuPopup> : menu
);

const MONACO_CONTEXT_MENU_STYLE_ID = 'gn-v2-monaco-context-menu-styles';
const MONACO_CONTEXT_MENU_STYLES = `
.monaco-menu {
  min-width: 264px !important;
  overflow: hidden !important;
  padding: 4px !important;
  border: 0.5px solid var(--gn-br-2) !important;
  border-radius: var(--gn-v2-menu-surface-radius, 10px) !important;
  background: var(--gn-bg-panel) !important;
  color: var(--gn-fg-1) !important;
  box-shadow: var(--gn-shadow-lg) !important;
}
.monaco-menu > .gn-v2-monaco-context-menu-header {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  column-gap: 6px;
  row-gap: 3px;
  align-items: center;
  margin: -4px -4px 4px;
  padding: 10px 12px;
  border-bottom: 0.5px solid var(--gn-br-1);
  border-radius: 9px 9px 0 0;
  background: var(--gn-bg-panel-2);
  font-family: var(--gn-font-sans);
}
.gn-v2-monaco-context-menu-header .gn-v2-action-menu-header-icon {
  width: 16px;
  color: var(--gn-info);
  font-family: var(--gn-font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: -0.04em;
}
.gn-v2-monaco-context-menu-header .gn-v2-context-menu-heading { display: contents; }
.gn-v2-monaco-context-menu-header strong {
  grid-column: 2;
  min-width: 0;
  overflow: hidden;
  color: var(--gn-fg-1);
  font-family: var(--gn-font-mono);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gn-v2-monaco-context-menu-header small {
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--gn-fg-4);
  font-family: var(--gn-font-mono);
  font-size: 10.5px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.monaco-menu .monaco-action-bar.vertical .action-menu-item,
.monaco-menu .monaco-action-bar.vertical .action-label:not(.separator) {
  min-height: var(--gn-v2-menu-row-height, 28px) !important;
  border-radius: var(--gn-v2-menu-item-radius, 5px) !important;
  font-size: 12.5px !important;
  line-height: var(--gn-v2-menu-row-height, 28px) !important;
}
.monaco-menu .monaco-action-bar.vertical .action-label:not(.separator) {
  padding: 0 8px !important;
}
.monaco-menu .monaco-action-bar.vertical .action-menu-item:focus {
  background: var(--gn-bg-active) !important;
  color: var(--gn-fg-1) !important;
  outline: none !important;
}
.monaco-menu .monaco-action-bar .action-item .action-label.separator {
  width: auto !important;
  height: 1px !important;
  min-height: 1px !important;
  margin: 4px !important;
  padding: 0 !important;
  border: 0 !important;
  background: var(--gn-br-1) !important;
}
`;

export const decorateV2MonacoContextMenu = (title: string, meta?: string): void => {
  const roots: Array<Document | ShadowRoot> = [document];
  document.querySelectorAll<HTMLElement>('*').forEach((element) => {
    if (element.shadowRoot) roots.push(element.shadowRoot);
  });

  const menus = roots.flatMap((root) => {
    if (root instanceof ShadowRoot && !root.getElementById(MONACO_CONTEXT_MENU_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = MONACO_CONTEXT_MENU_STYLE_ID;
      style.textContent = MONACO_CONTEXT_MENU_STYLES;
      root.append(style);
    }
    return Array.from(root.querySelectorAll<HTMLElement>('.monaco-menu'));
  }).filter((menu) => menu.getClientRects().length > 0);
  const menu = menus[menus.length - 1];
  if (!menu) return;

  const existing = menu.querySelector<HTMLElement>(':scope > .gn-v2-monaco-context-menu-header');
  if (existing) {
    const titleElement = existing.querySelector<HTMLElement>('.gn-v2-context-menu-heading strong');
    if (titleElement) titleElement.textContent = title;
    const metaElement = existing.querySelector<HTMLElement>('.gn-v2-context-menu-heading small');
    if (metaElement) metaElement.textContent = meta || '';
    return;
  }

  const header = document.createElement('div');
  header.className = 'gn-v2-context-menu-header gn-v2-action-menu-header gn-v2-monaco-context-menu-header';

  const icon = document.createElement('span');
  icon.className = 'gn-v2-context-menu-table-icon gn-v2-action-menu-header-icon gn-v2-monaco-context-menu-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'SQL';

  const heading = document.createElement('span');
  heading.className = 'gn-v2-context-menu-heading';
  const strong = document.createElement('strong');
  strong.textContent = title;
  heading.appendChild(strong);
  if (meta) {
    const small = document.createElement('small');
    small.textContent = meta;
    heading.appendChild(small);
  }

  header.append(icon, heading);
  menu.prepend(header);
};

export default V2ActionMenuPopup;
