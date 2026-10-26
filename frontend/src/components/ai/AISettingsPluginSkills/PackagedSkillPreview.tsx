import { useState } from 'react';
import { Alert, Button, Modal, Spin, Tag } from 'antd';
import type { usePackagedSkillPreview } from '../../../plugins/skills/usePackagedSkillPreview';
import type { PackagedSkillDescriptor } from '../../../plugins/skills/types';
import { packagedSkillAPI } from '../../../plugins/skills/api';
import { packagedSkillErrorKey } from '../../../plugins/skills/errors';
import { useSkillCopy } from './useSkillCopy';

export function PackagedSkillPreview({ state }: { state: ReturnType<typeof usePackagedSkillPreview> }) {
  const t = useSkillCopy(); const skill = state.selection;
  if (!skill) return null;
  return <Modal open title={t('plugin.skills.preview_title')} width={840} onCancel={state.close} destroyOnClose
    footer={<Button onClick={state.close}>{t('common.close')}</Button>}>
    <div className="gonavi-packaged-skill-preview">
      <div><Tag>{t('plugin.skills.read_only')}</Tag><strong>{skill.name}</strong></div>
      <Alert type="warning" showIcon message={t('plugin.skills.untrusted_text')} />
      <dl className="gonavi-packaged-skill-facts">
        <dt>{t('plugin.skills.source')}</dt><dd><code>{skill.pluginId}</code></dd>
        <dt>{t('plugin.skills.skill_id')}</dt><dd><code>{skill.id}</code></dd>
        <dt>{t('plugin.skills.version')}</dt><dd>{skill.version}</dd>
        <dt>{t('plugin.skills.entry')}</dt><dd><code>{skill.entry}</code></dd>
        <dt>{t('plugin.skills.digest')}</dt><dd><code>{skill.digest}</code></dd>
        <dt>{t('plugin.skills.generation')}</dt><dd>{skill.generation}</dd>
      </dl>
      <SkillCompanions key={skill.pluginId + ':' + skill.id + ':' + skill.digest + ':' + skill.generation} skill={skill} />
      {state.loading && <div role="status"><Spin size="small" /> {t('plugin.skills.loading_body')}</div>}
      {state.error && <Alert type="error" showIcon message={t(state.error)} />}
      {state.content !== null && <pre className="gonavi-packaged-skill-body" aria-label={t('plugin.skills.document')}>{state.content}</pre>}
    </div>
  </Modal>;
}

function SkillCompanions({ skill }: { skill: PackagedSkillDescriptor }) {
  const t = useSkillCopy();
  const [companion, setCompanion] = useState<{ path: string; text: string } | null>(null);
  const [error, setError] = useState('');
  if (!skill.resources?.length) return null;
  return <div>
    <div>{t('plugin.skills.resources')}</div>
    {skill.resources.map((resource) => <Button key={resource} size="small" onClick={() => {
      setError('');
      void packagedSkillAPI.readResource(skill, resource).then((value) => setCompanion({ path: resource, text: value.content })).catch((cause: unknown) => { setCompanion(null); setError(packagedSkillErrorKey(cause)); });
    }}>{resource}</Button>)}
    {error && <Alert type="error" showIcon message={t(error)} />}
    {companion && <pre className="gonavi-packaged-skill-body" aria-label={companion.path}>{companion.text}</pre>}
  </div>;
}
