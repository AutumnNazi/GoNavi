// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { t } from '../i18n';
import { DETACH_TAB_DRAG_Y_THRESHOLD } from '../utils/detachedWindow';
import DetachDragPreview, {
  buildDetachDragPreviewState,
  DETACH_PREVIEW_REVEAL_DISTANCE,
  type DetachDragPreviewState,
} from './DetachDragPreview';

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

const build = (deltaY: number) => buildDetachDragPreviewState({ title: 'RFM', clientX: 200, clientY: 120, deltaY });

const renderPreview = (preview: DetachDragPreviewState | null) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<DetachDragPreview preview={preview} />);
  });
  return root;
};

describe('DetachDragPreview', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('stays hidden while the tab is only moved sideways along the tab bar', () => {
    expect(build(0)).toBeNull();
    expect(build(DETACH_PREVIEW_REVEAL_DISTANCE - 1)).toBeNull();
    expect(build(-(DETACH_PREVIEW_REVEAL_DISTANCE - 1))).toBeNull();
    expect(build(Number.NaN)).toBeNull();
  });

  it('appears once the tab is pulled away from the bar and is ready at the detach threshold', () => {
    expect(build(DETACH_PREVIEW_REVEAL_DISTANCE)).toMatchObject({ willDetach: false });
    expect(build(-DETACH_TAB_DRAG_Y_THRESHOLD)).toMatchObject({ willDetach: true, progress: 1 });
  });

  it('explains what releasing does instead of showing a bare percentage', () => {
    renderPreview(build(DETACH_PREVIEW_REVEAL_DISTANCE + 10));
    const pending = document.body.querySelector('.gn-detach-preview');
    expect(pending?.textContent).toContain(t('detach_preview.keep_dragging'));
    expect(pending?.textContent).not.toMatch(/\d+%/);
    document.body.replaceChildren();

    renderPreview(build(DETACH_TAB_DRAG_Y_THRESHOLD));
    const ready = document.body.querySelector('.gn-detach-preview.is-ready');
    expect(ready?.textContent).toContain(t('detach_preview.release_to_open'));
  });
});
