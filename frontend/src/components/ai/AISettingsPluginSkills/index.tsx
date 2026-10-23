import { Alert, Button, Tag } from 'antd';
import { usePackagedSkillCatalog } from '../../../plugins/skills/usePackagedSkillCatalog';
import { usePackagedSkillPreview } from '../../../plugins/skills/usePackagedSkillPreview';
import { PackagedSkillList } from './PackagedSkillList';
import { PackagedSkillPreview } from './PackagedSkillPreview';
import { useSkillCopy } from './useSkillCopy';
import './styles.css';

export function AISettingsPluginSkills({ active = true }: { active?: boolean }) {
  const t = useSkillCopy(); const catalog = usePackagedSkillCatalog(active);
  const preview = usePackagedSkillPreview(catalog.items, active);
  if (!active) return null;
  return <section className="gonavi-packaged-skills" aria-label={t('plugin.skills.title')}>
    <header className="gonavi-packaged-skills-header"><div><h4>{t('plugin.skills.title')}</h4><Tag>{t('plugin.skills.read_only')}</Tag></div>
      <Button onClick={() => void catalog.refresh()} loading={catalog.loading}>{t('plugin.action.refresh')}</Button>
    </header>
    <p>{t('plugin.skills.no_auto_injection')}</p>
    <p className="gonavi-packaged-skill-muted">{t('plugin.skills.agent_support')}</p>
    <p className="gonavi-packaged-skill-muted">{t('plugin.skills.agent_budget')}</p>
    {catalog.error && <Alert type="warning" showIcon message={t(catalog.error)} />}
    {(catalog.loading || (!catalog.loaded && !catalog.error)) && <p role="status">{t('plugin.skills.loading_catalog')}</p>}
    {(catalog.items.length > 0 || (catalog.loaded && !catalog.error && !catalog.loading)) && <PackagedSkillList items={catalog.items} busy={preview.busy} onPreview={preview.preview} />}
    {preview.busy && !preview.selection && <p role="status">{t('plugin.skills.error.pending')}</p>}
    <PackagedSkillPreview state={preview} />
  </section>;
}
