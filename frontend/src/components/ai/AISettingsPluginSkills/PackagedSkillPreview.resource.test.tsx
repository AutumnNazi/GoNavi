import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
const readResource = vi.hoisted(() => vi.fn());
vi.mock('antd', () => ({
  Modal: ({ children, footer }: { children?: React.ReactNode; footer?: React.ReactNode }) => <section>{children}{footer}</section>,
  Alert: ({ message }: { message?: React.ReactNode }) => <div>{message}</div>,
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Spin: () => <span />,
}));
vi.mock('../../../plugins/skills/api', () => ({ packagedSkillAPI: { readResource } }));
import { PackagedSkillPreview } from './PackagedSkillPreview';
const longResource = 'a'.repeat(200) + '/' + 'b'.repeat(200) + '/notes.md';
const skill = { pluginId: 'example.docs', id: 'guide', name: 'Guide', description: 'Read-only guidance', entry: 'SKILL.md',
  resources: [longResource], version: '1.0.0', digest: 'a'.repeat(64), generation: 2, available: true };
describe('packaged skill companion preview', () => {
  it('opens one host-sized companion without replacing the entry document', async () => {
    readResource.mockResolvedValue({ content: 'SECRET_COMPANION' });
    let view: ReturnType<typeof create> | undefined;
    await act(async () => { view = create(<PackagedSkillPreview state={{ selection: skill, content: 'entry only', loading: false, busy: false, error: '', preview: async () => {}, close: () => {}, selectedKey: 'example.docs:guide' }} />); });
    const button = view?.root.findAllByType('button').find((node) => node.children.join('') === longResource);
    await act(async () => { button?.props.onClick(); await Promise.resolve(); });
    expect(readResource).toHaveBeenCalledWith(skill, longResource);
    const text = JSON.stringify(view?.toJSON());
    expect(text).toContain('SECRET_COMPANION');
    expect(text).toContain('entry only');
    view?.unmount();
  });
});
