import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
vi.mock('antd', () => {
  const Input = (props: Record<string, unknown>) => createElement('input', props);
  Input.TextArea = (props: Record<string, unknown>) => createElement('textarea', props);
  return { Input, Button: (props: Record<string, unknown>) => createElement('button', props),
    Select: (props: Record<string, unknown>) => createElement('select', props), Popconfirm: (props: Record<string, unknown>) => createElement('aside', props) };
});
vi.mock('@ant-design/icons', () => ({ DeleteOutlined: () => null }));
import { AISettingsUserSkillFields } from './AISettingsUserSkillFields';
import type { AISkillConfig } from '../../types';
const skill: AISkillConfig = { id: 'user-skill', name: 'Original', description: 'User description', scopes: ['global'], requiredTools: ['sql_read'], systemPrompt: 'User-authored prompt', enabled: true };
describe('legacy user skill fields after extraction', () => {
  it('keeps all user-edit/save/delete callbacks and draft values unchanged', () => {
    const update = vi.fn(); const save = vi.fn(); const remove = vi.fn();
    const renderer = create(<AISettingsUserSkillFields skill={skill} skillRequiredToolOptions={[{ label: 'Read SQL', value: 'sql_read' }]}
      cardBorder="#eee" inputBg="#fff" loading={false} copy={(key) => key} onUpdateSkillDraft={update} onSaveSkill={save} onDeleteSkill={remove} />);
    const inputs = renderer.root.findAllByType('input'); const selects = renderer.root.findAllByType('select'); const prompt = renderer.root.findByType('textarea');
    expect(prompt.props.value).toBe(skill.systemPrompt); expect(selects[2].props.value).toEqual(['sql_read']);
    act(() => {
      inputs[0].props.onChange({ target: { value: 'Changed' } }); inputs[1].props.onChange({ target: { value: 'Description' } });
      selects[0].props.onChange('disabled'); selects[1].props.onChange(['database']); selects[2].props.onChange(['sql_read', 'explain']);
      prompt.props.onChange({ target: { value: 'Changed prompt' } }); renderer.root.findAllByType('button')[0].props.onClick(); renderer.root.findByType('aside').props.onConfirm();
    });
    expect(update.mock.calls).toEqual([['user-skill', { name: 'Changed' }], ['user-skill', { description: 'Description' }], ['user-skill', { enabled: false }],
      ['user-skill', { scopes: ['database'] }], ['user-skill', { requiredTools: ['sql_read', 'explain'] }], ['user-skill', { systemPrompt: 'Changed prompt' }]]);
    expect(save).toHaveBeenCalledWith(skill); expect(remove).toHaveBeenCalledWith('user-skill'); act(() => renderer.unmount());
  });
});
