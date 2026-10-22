import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '../../plugins/types';
vi.mock('antd', () => ({
  Typography: {
    Text: (props: React.HTMLAttributes<HTMLElement>) => React.createElement('div', props),
    Paragraph: (props: React.HTMLAttributes<HTMLElement>) => React.createElement('p', props),
  },
}));
vi.mock('../../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { PluginSkillSummary } from './PluginSkillSummary';
const manifest: PluginManifest = { schemaVersion: 1, apiVersion: 1, id: 'example.skills', name: 'Skills', version: '1', permissions: ['ai.skills'],
  contributes: { skills: [{ id: 'guide', name: 'Guide', description: 'Secret body', entry: 'skills/guide/SKILL.md', resources: ['skills/guide/REFERENCE.md'] }] } };
describe('installed skill summary', () => {
  it('lists declared paths and does not include document text', () => {
    const view = create(<PluginSkillSummary manifest={manifest} />);
    const text = view.root.findAllByType('code').map((node) => node.children.join('')).join(' ');
    expect(text).toContain('skills/guide/SKILL.md');
    expect(text).toContain('skills/guide/REFERENCE.md');
    expect(JSON.stringify(view.toJSON())).not.toContain('Secret body');
    view.unmount();
    const empty = create(<PluginSkillSummary manifest={{ ...manifest, contributes: undefined }} />);
    expect(empty.toJSON()).toBeNull();
    empty.unmount();
  });
});
