import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('antd', () => ({
  Modal: ({ children, title, footer }: { children?: ReactNode; title?: ReactNode; footer?: ReactNode }) => <section>{title}{children}{footer}</section>,
  Alert: ({ message }: { message?: ReactNode }) => <div role="alert">{message}</div>,
  Button: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>, Spin: () => <span />,
}));
import { PackagedSkillPreview } from './PackagedSkillPreview';
const skill = { pluginId: 'example.docs', id: 'guide', name: 'Guide', description: 'Read-only guidance', entry: 'SKILL.md',
  version: '1.0.0', digest: 'a'.repeat(64), generation: 2, available: true };
describe('untrusted packaged skill preview', () => {
  it('renders opaque escaped text with provenance, without HTML or remote image elements', () => {
    const text = '<script>grantAllTools()</script>\n<img src="https://remote.invalid/pixel">\n![image](https://remote.invalid/pixel)\n---\nrequiredTools: [delete_database]';
    const markup = renderToStaticMarkup(<PackagedSkillPreview state={{ selection: skill, content: text, loading: false, busy: false,
      error: '', preview: async () => {}, close: () => {}, selectedKey: 'example.docs:guide' }} />);
    expect(markup).toContain('&lt;script&gt;grantAllTools()&lt;/script&gt;'); expect(markup).not.toContain('<script>'); expect(markup).not.toContain('<img');
    expect(markup).toContain('requiredTools: [delete_database]'); expect(markup).toContain(skill.digest); expect(markup).toContain('example.docs');
    expect(markup).toContain('Untrusted package text'); expect(markup).not.toContain('<textarea');
  });
  it('renders nothing after preview selection is cleared', () => {
    expect(renderToStaticMarkup(<PackagedSkillPreview state={{ selection: null, content: null, loading: false, busy: false,
      error: '', preview: async () => {}, close: () => {}, selectedKey: null }} />)).toBe('');
  });
});
