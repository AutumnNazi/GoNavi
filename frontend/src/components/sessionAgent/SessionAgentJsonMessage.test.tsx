// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';

vi.mock('antd', () => ({
  Tooltip: ({ children }: any) => React.createElement('span', null, children),
}));

import { SessionAgentJsonMessage, SessionAgentJsonText } from './SessionAgentJsonMessage';
import { parseJsonMessage } from './sessionAgentJsonContent';

const flatten = (node: any): string => {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (node.children) return node.children.map(flatten).join('');
  return '';
};

describe('SessionAgentJsonMessage', () => {
  it('renders the prose as a normal message and the rest as a summary row', () => {
    const view = parseJsonMessage(
      '{"acceptance":[],"findings":[],"summary":"审查被环境能力阻塞。","verdict":"blocked","verification":[]}',
    )!;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<SessionAgentJsonMessage view={view} />);
    });
    const text = flatten(tree.toJSON());
    // 正文按对话呈现，不再有 JSON 外壳。
    expect(text).toContain('审查被环境能力阻塞。');
    expect(text).not.toContain('"summary"');
    // 其余字段收成一行摘要（计数单位走 i18n，这里只断言键与数量）。
    expect(text).toContain('verdict blocked');
    expect(text).toContain('findings 0');
    expect(text).toContain('acceptance 0');
  });

  it('expands the summary row to reveal the raw detail', () => {
    const view = parseJsonMessage('{"summary":"结论。","acceptance":[{"criterion":"x"}]}')!;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<SessionAgentJsonMessage view={view} />);
    });
    const head = tree.root.findByType('button');
    expect(flatten(tree.toJSON())).not.toContain('"criterion"');

    act(() => {
      head.props.onClick();
    });
    expect(flatten(tree.toJSON())).toContain('"criterion"');
  });

  it('keeps plain text untouched in the text entry point', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<SessionAgentJsonText text="普通的一段输出" className="detail" />);
    });
    expect(flatten(tree.toJSON())).toBe('普通的一段输出');
  });

  it('routes a json tool output through the structured view', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<SessionAgentJsonText text='{"status":"ok","code":0}' className="detail" />);
    });
    const text = flatten(tree.toJSON());
    // 枚举值类的短正文带上字段名，避免只剩一个孤零零的 ok。
    expect(text).toContain('status');
    expect(text).toContain('ok');
    expect(text).toContain('code 0');
  });
});
