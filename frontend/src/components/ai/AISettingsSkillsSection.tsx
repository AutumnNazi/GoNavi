import React from 'react';
import { Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { AISkillConfig } from '../../types';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import { AISettingsPluginSkills } from './AISettingsPluginSkills';
import { AISettingsUserSkillCard } from './AISettingsUserSkillCard';

interface AISettingsSkillsSectionProps {
  active?: boolean;
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

const AISettingsSkillsSection: React.FC<AISettingsSkillsSectionProps> = ({
  active = true,
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
      {skills.map((skill) => <AISettingsUserSkillCard key={skill.id} skill={skill} overlayTheme={overlayTheme}
        expanded={expandedSkillIds[skill.id] ?? skill.id.startsWith('skill-draft-')}
        onExpandedChange={(open) => setExpandedSkillIds((current) => current[skill.id] === open ? current : { ...current, [skill.id]: open })}
        skillRequiredToolOptions={skillRequiredToolOptions} cardBorder={cardBorder} inputBg={inputBg} loading={loading} copy={copy}
        onUpdateSkillDraft={onUpdateSkillDraft} onSaveSkill={onSaveSkill} onDeleteSkill={onDeleteSkill} />)}
      <AISettingsPluginSkills active={active} />
    </div>
  );
};

export default AISettingsSkillsSection;
