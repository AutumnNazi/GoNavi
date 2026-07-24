import React from 'react';
import { Button, Input, Popconfirm, Select } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { AISkillConfig, AISkillScope } from '../../types';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';

interface AISettingsSkillsSectionProps {
  skills: AISkillConfig[];
  skillRequiredToolOptions: Array<{ label: string; value: string }>;
  overlayTheme: OverlayWorkbenchTheme;
  cardBg: string;
  cardBorder: string;
  inputBg: string;
  loading: boolean;
  onAddSkill: () => void;
  onUpdateSkillDraft: (id: string, patch: Partial<AISkillConfig>) => void;
  onSaveSkill: (skill: AISkillConfig) => void;
  onDeleteSkill: (id: string) => void;
}

const SKILL_SCOPE_OPTIONS: Array<{ value: AISkillScope; labelKey: string; descKey: string }> = [
  { value: 'global', labelKey: 'ai_settings.skill.scope.global.label', descKey: 'ai_settings.skill.scope.global.desc' },
  { value: 'database', labelKey: 'ai_settings.skill.scope.database.label', descKey: 'ai_settings.skill.scope.database.desc' },
  { value: 'jvm', labelKey: 'ai_settings.skill.scope.jvm.label', descKey: 'ai_settings.skill.scope.jvm.desc' },
  { value: 'jvmDiagnostic', labelKey: 'ai_settings.skill.scope.jvm_diagnostic.label', descKey: 'ai_settings.skill.scope.jvm_diagnostic.desc' },
];

const AISettingsSkillsSection: React.FC<AISettingsSkillsSectionProps> = ({
  skills,
  skillRequiredToolOptions,
  overlayTheme,
  cardBorder,
  inputBg,
  loading,
  onAddSkill,
  onUpdateSkillDraft,
  onSaveSkill,
  onDeleteSkill,
}) => {
  const i18n = useOptionalI18n();
  const copy = (key: string) => (i18n?.t ?? ((catalogKey) => catalogTranslate('en-US', catalogKey)))(key);
  const [expandedSkillIds, setExpandedSkillIds] = React.useState<Record<string, boolean>>({});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          paddingBottom: 14,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--gn-settings-font-secondary, 13px)', color: overlayTheme.mutedText, lineHeight: 1.6 }}>
            {copy('ai_settings.skill.description')}
          </div>
          <div style={{ marginTop: 5, fontSize: 'var(--gn-font-size-sm, 12px)', color: overlayTheme.mutedText, lineHeight: 1.5 }}>
            {copy('ai_settings.skill.hint')}
          </div>
        </div>
        <Button icon={<PlusOutlined />} onClick={onAddSkill}>
          {copy('ai_settings.skill.action.add')}
        </Button>
      </div>
      {skills.length === 0 && (
        <div
          className="gonavi-ai-skill-empty"
          style={{ padding: '18px 2px', borderRadius: 4, color: overlayTheme.mutedText }}
        >
          {copy('ai_settings.skill.empty')}
        </div>
      )}
      {skills.map((skill) => {
        const scopeSummary = (skill.scopes || [])
          .map((scope) => SKILL_SCOPE_OPTIONS.find((option) => option.value === scope))
          .filter((option): option is (typeof SKILL_SCOPE_OPTIONS)[number] => Boolean(option))
          .map((option) => copy(option.labelKey))
          .join(' / ');
        const summaryTitle = skill.name.trim() || copy('ai_settings.skill.action.add');
        const expanded = expandedSkillIds[skill.id] ?? skill.id.startsWith('skill-draft-');

        return (
        <details
          key={skill.id}
          className="gonavi-ai-skill-editor"
          open={expanded}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setExpandedSkillIds((current) => current[skill.id] === open
              ? current
              : { ...current, [skill.id]: open });
          }}
          style={{ borderRadius: 4 }}
        >
          <summary style={{ cursor: 'pointer', padding: '13px 2px', color: overlayTheme.titleText }}>
            <span
              style={{
                display: 'inline-grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                alignItems: 'center',
                gap: 12,
                width: 'calc(100% - 18px)',
                marginLeft: 8,
                verticalAlign: 'middle',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 'var(--gn-settings-font-secondary, 13px)', fontWeight: 650 }}>{summaryTitle}</span>
                {(skill.description || scopeSummary) && (
                  <span
                    style={{
                      display: 'block',
                      marginTop: 3,
                      color: overlayTheme.mutedText,
                      fontSize: 'var(--gn-font-size-sm, 12px)',
                      lineHeight: 1.45,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {skill.description || scopeSummary}
                  </span>
                )}
              </span>
              <span
                style={{
                  padding: '2px 7px',
                  borderRadius: 999,
                  color: skill.enabled ? overlayTheme.selectedText : overlayTheme.mutedText,
                  background: skill.enabled ? overlayTheme.selectedBg : 'transparent',
                  border: `1px solid ${skill.enabled ? overlayTheme.selectedText : cardBorder}`,
                  fontSize: 'var(--gn-font-size-sm, 12px)',
                  fontWeight: 650,
                  whiteSpace: 'nowrap',
                }}
              >
                {copy(skill.enabled ? 'ai_settings.skill.status.enabled' : 'ai_settings.skill.status.disabled')}
              </span>
            </span>
          </summary>

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
        </details>
        );
      })}
    </div>
  );
};

export default AISettingsSkillsSection;
