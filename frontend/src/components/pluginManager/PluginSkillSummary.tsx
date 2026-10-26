import { Typography } from 'antd';
import { useI18n } from '../../i18n/provider';
import type { PluginManifest } from '../../plugins/types';

export function PluginSkillSummary({ manifest }: { manifest: PluginManifest }) {
  const { t } = useI18n();
  const skills = manifest.contributes?.skills ?? [];
  if (!skills.length) return null;
  return <div><Typography.Text strong>{t('plugin.skills.title')}</Typography.Text>
    <Typography.Paragraph type="secondary">{t('plugin.skills.no_auto_injection')}</Typography.Paragraph>
    <ul>{skills.map((skill) => <li key={skill.id}><code>{skill.id}</code> <code>{skill.entry}</code> {(skill.resources ?? []).map((resource) => <code key={resource}>{resource}</code>)}</li>)}</ul></div>;
}
