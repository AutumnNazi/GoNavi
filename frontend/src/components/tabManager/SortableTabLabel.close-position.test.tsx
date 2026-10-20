// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SortableTabLabel } from './SortableTabLabel';
import type { TabData } from '../../types';
import { buildTabDisplayModel } from '../../utils/tabDisplay';
import type { TabCloseButtonPosition } from '../../utils/tabAppearance';

const TAB: TabData = {
  id: 'tab-users',
  title: 'users',
  type: 'table',
  connectionId: 'conn-1',
  tableName: 'users',
};

type RenderLabelOptions = {
  closeButtonPosition?: TabCloseButtonPosition;
  environmentColor?: string;
};

const renderLabel = ({ closeButtonPosition, environmentColor }: RenderLabelOptions = {}) => {
  const displayModel = buildTabDisplayModel(TAB, undefined);
  const markup = renderToStaticMarkup(
    <SortableTabLabel
      tab={TAB}
      displayModel={displayModel}
      displayTitle={displayModel.fullTitle}
      menuItems={[]}
      environmentColor={environmentColor}
      closeButtonPosition={closeButtonPosition}
      onClose={() => undefined}
    />,
  );
  const label = new DOMParser()
    .parseFromString(markup, 'text/html')
    .querySelector<HTMLElement>('.tab-dnd-label');
  if (!label) throw new Error(`tab label was not rendered: ${markup}`);
  return label;
};

const resolveCloseButton = (label: HTMLElement) => {
  const close = label.querySelector('.gn-v2-tab-close');
  if (!close) throw new Error('close button was not rendered');
  return close;
};

describe('SortableTabLabel close button position', () => {
  it('keeps the close button last by default', () => {
    const label = renderLabel();

    expect(label.getAttribute('data-tab-close-position')).toBe('right');
    expect(label.lastElementChild).toBe(resolveCloseButton(label));
  });

  it('moves the close button first when the position is left', () => {
    const label = renderLabel({ closeButtonPosition: 'left' });

    expect(label.getAttribute('data-tab-close-position')).toBe('left');
    expect(label.firstElementChild).toBe(resolveCloseButton(label));
  });

  it('keeps the left close button in front of the absolutely positioned environment accent', () => {
    const label = renderLabel({ closeButtonPosition: 'left', environmentColor: 'rgb(1, 2, 3)' });

    expect(label.firstElementChild).toBe(resolveCloseButton(label));
    expect(label.querySelector('.gn-tab-environment-accent')).not.toBeNull();
  });

  it('keeps the close button markup identical on both sides', () => {
    const rightClose = resolveCloseButton(renderLabel());
    const leftClose = resolveCloseButton(renderLabel({ closeButtonPosition: 'left' }));

    [rightClose, leftClose].forEach((close) => {
      expect(close.getAttribute('type')).toBe('button');
      expect(close.getAttribute('class')).toBe('gn-v2-tab-close');
      expect(close.getAttribute('aria-label')).toBeTruthy();
    });
    expect(leftClose.getAttribute('aria-label')).toBe(rightClose.getAttribute('aria-label'));
  });
});
