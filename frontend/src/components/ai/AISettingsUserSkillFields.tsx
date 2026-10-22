import { Button, Input, Popconfirm, Select } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { AISkillConfig, AISkillScope } from '../../types';
import { SKILL_SCOPE_OPTIONS } from './AISettingsUserSkillOptions';

export interface UserSkillFieldsProps {
  skill: AISkillConfig;
  skillRequiredToolOptions: Array<{ label: string; value: string }>;
  cardBorder: string;
  inputBg: string;
  loading: boolean;
  copy: (key: string) => string;
  onUpdateSkillDraft: (id: string, patch: Partial<AISkillConfig>) => void;
  onSaveSkill: (skill: AISkillConfig) => void;
  onDeleteSkill: (id: string) => void;
}
export function AISettingsUserSkillFields({ skill, skillRequiredToolOptions, cardBorder, inputBg, loading, copy,
  onUpdateSkillDraft, onSaveSkill, onDeleteSkill }: UserSkillFieldsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '2px 2px 16px 26px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 132px', gap: 12 }}>
        <Input
          aria-label={copy('ai_settings.skill.name_placeholder')}
          value={skill.name}
          onChange={(event) => onUpdateSkillDraft(skill.id, { name: event.target.value })}
          placeholder={copy('ai_settings.skill.name_placeholder')}
          style={{ background: inputBg, border: `1px solid ${cardBorder}` }}
        />
        <Select
          aria-label={copy(skill.enabled ? 'ai_settings.skill.status.enabled' : 'ai_settings.skill.status.disabled')}
          value={skill.enabled ? 'enabled' : 'disabled'}
          onChange={(value) => onUpdateSkillDraft(skill.id, { enabled: value === 'enabled' })}
          options={[
            { label: copy('ai_settings.skill.status.enabled'), value: 'enabled' },
            { label: copy('ai_settings.skill.status.disabled'), value: 'disabled' },
          ]}
        />
      </div>
      <Input
        aria-label={copy('ai_settings.skill.description_placeholder')}
        value={skill.description || ''}
        onChange={(event) => onUpdateSkillDraft(skill.id, { description: event.target.value })}
        placeholder={copy('ai_settings.skill.description_placeholder')}
        style={{ background: inputBg, border: `1px solid ${cardBorder}` }}
      />
      <Select
        aria-label={copy('ai_settings.skill.scopes_placeholder')}
        mode="multiple"
        value={skill.scopes || []}
        onChange={(value) => onUpdateSkillDraft(skill.id, { scopes: value as AISkillScope[] })}
        options={SKILL_SCOPE_OPTIONS.map((option) => ({
          label: `${copy(option.labelKey)} · ${copy(option.descKey)}`,
          value: option.value,
        }))}
        placeholder={copy('ai_settings.skill.scopes_placeholder')}
        style={{ width: '100%' }}
      />
      <Select
        aria-label={copy('ai_settings.skill.required_tools_placeholder')}
        mode="multiple"
        value={skill.requiredTools || []}
        onChange={(value) => onUpdateSkillDraft(skill.id, { requiredTools: value })}
        options={skillRequiredToolOptions}
        placeholder={copy('ai_settings.skill.required_tools_placeholder')}
        style={{ width: '100%' }}
      />
      <Input.TextArea
        aria-label={copy('ai_settings.skill.system_prompt_placeholder')}
        rows={6}
        value={skill.systemPrompt}
        onChange={(event) => onUpdateSkillDraft(skill.id, { systemPrompt: event.target.value })}
        placeholder={copy('ai_settings.skill.system_prompt_placeholder')}
        style={{ background: inputBg, border: `1px solid ${cardBorder}`, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button type="primary" onClick={() => onSaveSkill(skill)} loading={loading}>
          {copy('common.save')}
        </Button>
        <Popconfirm
          title={copy('ai_settings.skill.confirm_delete')}
          okText={copy('common.delete')}
          cancelText={copy('common.cancel')}
          onConfirm={() => onDeleteSkill(skill.id)}
        >
          <Button danger icon={<DeleteOutlined />}>
            {copy('common.delete')}
          </Button>
        </Popconfirm>
      </div>
    </div>
  );
}
