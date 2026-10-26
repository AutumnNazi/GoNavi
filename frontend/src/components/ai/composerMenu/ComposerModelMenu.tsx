import React, { useEffect, useRef, type CSSProperties, type RefObject } from 'react';

import type { ComposerProviderGroup } from './composerMenuModel';
import { modelChoices } from './composerMenuModel';
import { handleComposerMenuKey } from './composerMenuKeyboard';
import ComposerThoughtSlider, { type ThoughtLevel } from './ComposerThoughtSlider';

export interface ComposerMenuLabels {
  provider: string;
  models: string;
  effort: string;
  back: string;
  manage: string;
  empty: string;
  auto: string;
  loading: string;
}

interface ComposerModelMenuProps {
  groups: readonly ComposerProviderGroup[];
  activeProviderId: string;
  shownProviderId: string;
  currentModel: string;
  narrow: boolean;
  providerOpen: boolean;
  loading: boolean;
  levels: readonly ThoughtLevel[];
  effortValue: string;
  highspeed: boolean;
  labels: ComposerMenuLabels;
  menuStyle: CSSProperties;
  submenuStyle: CSSProperties;
  menuRef: RefObject<HTMLDivElement>;
  submenuRef: RefObject<HTMLDivElement>;
  onProviderOpenChange: (open: boolean) => void;
  onProviderHoverStart: () => void;
  onProviderHoverEnd: () => void;
  onProviderPointerEnter: (providerId: string) => void;
  onSelectProvider: (providerId: string) => void;
  onSelectModel: (providerId: string, model: string) => void;
  onEffortChange: (value: string) => void;
  onManage: () => void;
  onCloseProviders: () => void;
  onCloseMenu: () => void;
}

const Chevron: React.FC<{ direction: 'right' | 'left' }> = ({ direction }) => (
  <svg className="gn-zcode-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style={{ transform: direction === 'left' ? 'rotate(180deg)' : undefined }}>
    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ProviderList: React.FC<Pick<ComposerModelMenuProps, 'groups' | 'shownProviderId' | 'onSelectProvider' | 'onProviderPointerEnter'>> = ({
  groups, shownProviderId, onSelectProvider, onProviderPointerEnter,
}) => (
  <>
    {groups.map((group) => {
      const selected = group.provider.id === shownProviderId;
      return (
        <button
          key={group.provider.id}
          type="button"
          className="gn-zcode-menu-row"
          role="menuitemradio"
          aria-checked={selected}
          data-menu-item="true"
          data-provider-item="true"
          data-provider-id={group.provider.id}
          onPointerEnter={() => onProviderPointerEnter(group.provider.id)}
          onClick={() => onSelectProvider(group.provider.id)}
        >
          <span className="gn-zcode-menu-row-label">{group.provider.name || group.provider.id}</span>
          {selected ? <span className="gn-zcode-menu-row-aside"><CheckIcon /></span> : null}
        </button>
      );
    })}
  </>
);

const ModelList: React.FC<Pick<ComposerModelMenuProps, 'activeProviderId' | 'currentModel' | 'labels' | 'onSelectModel'> & { shown: ComposerProviderGroup }> = ({
  shown, activeProviderId, currentModel, labels, onSelectModel,
}) => {
  const choices = modelChoices(shown);
  if (choices.length === 0) {
    return <button type="button" className="gn-zcode-menu-row" aria-disabled="true" disabled>{labels.empty}</button>;
  }
  return (
    <div className="gn-zcode-model-list" data-composer-model-list>
      {choices.map((model) => {
        const selected = shown.provider.id === activeProviderId && model === currentModel;
        return (
          <button
            key={model || 'auto'}
            type="button"
            className="gn-zcode-menu-row"
            role="menuitemradio"
            aria-checked={selected}
            data-menu-item="true"
            data-model-id={model}
            onClick={() => onSelectModel(shown.provider.id, model)}
          >
            <span className="gn-zcode-menu-row-label">{model || labels.auto}</span>
            {selected ? <span className="gn-zcode-menu-row-aside"><CheckIcon /></span> : null}
          </button>
        );
      })}
    </div>
  );
};

const ComposerModelMenu: React.FC<ComposerModelMenuProps> = ({
  groups, activeProviderId, shownProviderId, currentModel, narrow, providerOpen, loading, levels, effortValue,
  highspeed, labels, menuStyle, submenuStyle, menuRef, submenuRef, onProviderOpenChange, onProviderHoverStart,
  onProviderHoverEnd, onProviderPointerEnter, onSelectProvider, onSelectModel, onEffortChange, onManage, onCloseProviders, onCloseMenu,
}) => {
  const keyboardFocus = useRef(false);
  useEffect(() => {
    if (!providerOpen || !keyboardFocus.current) return;
    keyboardFocus.current = false;
    const root = narrow ? menuRef.current : submenuRef.current;
    root?.querySelector<HTMLElement>('[data-provider-item="true"]')?.focus();
  }, [providerOpen, narrow, menuRef, submenuRef]);
  const shown = groups.find((group) => group.provider.id === shownProviderId) ?? groups[0];
  if (!shown) return null;
  const providerList = (
    <ProviderList
      groups={groups}
      shownProviderId={shownProviderId}
      onSelectProvider={onSelectProvider}
      onProviderPointerEnter={onProviderPointerEnter}
    />
  );
  return (
    <div
      ref={menuRef}
      className="gn-zcode-model-menu"
      style={menuStyle}
      role="menu"
      data-testid="composer-model-menu"
      onKeyDown={(event) => handleComposerMenuKey(event, {
        providerOpen, narrow, submenu: submenuRef.current,
      }, {
        openProviders: () => {
          keyboardFocus.current = true;
          onProviderOpenChange(true);
        },
        closeProviders: onCloseProviders,
        closeMenu: onCloseMenu,
      })}
    >
      {narrow && providerOpen ? (
        <>
          <button type="button" className="gn-zcode-menu-row" data-testid="composer-provider-back" data-menu-item="true" onClick={() => onProviderOpenChange(false)}>
            <Chevron direction="left" />
            <span>{labels.back}</span>
          </button>
          <div className="gn-zcode-menu-sep" />
          {providerList}
        </>
      ) : (
        <>
          <button
            type="button"
            className="gn-zcode-menu-row"
            data-testid="composer-provider-trigger"
            data-menu-item="true"
            aria-haspopup="menu"
            aria-expanded={providerOpen}
            aria-label={`${labels.provider}: ${shown.provider.name || shown.provider.id}`}
            onClick={() => onProviderOpenChange(!providerOpen)}
            onPointerEnter={() => { if (!narrow) onProviderHoverStart(); }}
            onPointerLeave={onProviderHoverEnd}
          >
            <span className="gn-zcode-menu-row-label">{shown.provider.name || shown.provider.id}</span>
            <span className="gn-zcode-menu-row-aside">
              {loading ? <span className="gn-zcode-spinner" role="status" aria-label={labels.loading} /> : <Chevron direction="right" />}
            </span>
          </button>
          {providerOpen && !narrow ? (
            <div
              ref={submenuRef}
              className="gn-zcode-provider-menu"
              style={submenuStyle}
              role="menu"
              aria-label={labels.provider}
              onPointerEnter={onProviderHoverStart}
              onPointerLeave={onProviderHoverEnd}
            >
              {providerList}
            </div>
          ) : null}
          <div className="gn-zcode-menu-sep" />
          <div className="gn-zcode-menu-label">{labels.models}</div>
          <ModelList shown={shown} activeProviderId={activeProviderId} currentModel={currentModel} labels={labels} onSelectModel={onSelectModel} />
          {levels.length > 0 ? (
            <>
              <div className="gn-zcode-menu-sep" />
              <ComposerThoughtSlider
                levels={levels}
                value={effortValue}
                active={shown.provider.id === activeProviderId}
                disabled={shown.provider.id !== activeProviderId}
                highspeed={highspeed}
                heading={labels.effort}
                visualKey={`${activeProviderId}:${currentModel}:${levels.map((level) => level.value).join('|')}`}
                onChange={onEffortChange}
              />
            </>
          ) : null}
          <div className="gn-zcode-menu-sep" />
          <button type="button" className="gn-zcode-menu-row" data-testid="composer-manage-models" data-menu-item="true" onClick={onManage}>
            <span className="gn-zcode-menu-row-label">{labels.manage}</span>
          </button>
        </>
      )}
    </div>
  );
};

export default ComposerModelMenu;
