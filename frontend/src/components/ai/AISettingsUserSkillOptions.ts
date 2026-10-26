import type { AISkillScope } from '../../types';

export const SKILL_SCOPE_OPTIONS: Array<{ value: AISkillScope; labelKey: string; descKey: string }> = [
  { value: 'global', labelKey: 'ai_settings.skill.scope.global.label', descKey: 'ai_settings.skill.scope.global.desc' },
  { value: 'database', labelKey: 'ai_settings.skill.scope.database.label', descKey: 'ai_settings.skill.scope.database.desc' },
  { value: 'jvm', labelKey: 'ai_settings.skill.scope.jvm.label', descKey: 'ai_settings.skill.scope.jvm.desc' },
  { value: 'jvmDiagnostic', labelKey: 'ai_settings.skill.scope.jvm_diagnostic.label', descKey: 'ai_settings.skill.scope.jvm_diagnostic.desc' },
];
