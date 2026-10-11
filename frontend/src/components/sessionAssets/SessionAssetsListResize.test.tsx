// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, create } from 'react-test-renderer';
import {
  SESSION_ASSETS_LIST_WIDTH_KEY,
  SessionAssetsListResizeDivider,
  loadSessionAssetsListWidth,
  saveSessionAssetsListWidth,
} from './SessionAssetsListResize';

// 分割条拖拽：松手提交宽度并持久化，下次打开由 load 恢复（用户反馈：
// 列表占比过大且不可调整）。

afterEach(() => {
  window.localStorage.removeItem(SESSION_ASSETS_LIST_WIDTH_KEY);
});

describe('session assets list width persistence', () => {
  it('round-trips a committed width', () => {
    expect(loadSessionAssetsListWidth()).toBeUndefined();
    saveSessionAssetsListWidth(520);
    expect(loadSessionAssetsListWidth()).toBe(520);
  });

  it('ignores stored values below the minimum', () => {
    window.localStorage.setItem(SESSION_ASSETS_LIST_WIDTH_KEY, '10');
    expect(loadSessionAssetsListWidth()).toBeUndefined();
  });
});

describe('SessionAssetsListResizeDivider', () => {
  it('commits the dragged width and persists it', async () => {
    const container = document.createElement('div');
    const list = document.createElement('aside');
    const dividerHost = document.createElement('div');
    container.appendChild(list);
    container.appendChild(dividerHost);
    document.body.appendChild(container);

    let committed = 0;
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <SessionAssetsListResizeDivider onCommit={(width) => { committed = width; saveSessionAssetsListWidth(width); }} />,
      );
    });
    const divider = tree!.root.find((node) => node.props.role === 'separator');
    // jsdom 无布局：手工构造 previousElementSibling 与坐标。
    divider.props.onMouseDown({
      preventDefault: () => {},
      currentTarget: dividerHost,
      clientX: 100,
    });
    expect(document.querySelectorAll('div[style*="col-resize"]').length).toBeGreaterThan(0);
    document.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: 600 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(committed).toBe(500);
    expect(loadSessionAssetsListWidth()).toBe(500);
    container.remove();
  });

  it('clamps the dragged width to the minimum', async () => {
    const container = document.createElement('div');
    const list = document.createElement('aside');
    const dividerHost = document.createElement('div');
    container.appendChild(list);
    container.appendChild(dividerHost);
    document.body.appendChild(container);

    let committed = 0;
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <SessionAssetsListResizeDivider onCommit={(width) => { committed = width; }} />,
      );
    });
    const divider = tree!.root.find((node) => node.props.role === 'separator');
    divider.props.onMouseDown({
      preventDefault: () => {},
      currentTarget: dividerHost,
      clientX: 100,
    });
    document.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: 50 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(committed).toBe(240);
    container.remove();
  });
});
