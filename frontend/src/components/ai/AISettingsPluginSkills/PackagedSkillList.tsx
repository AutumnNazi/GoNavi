import { useMemo, useState } from 'react';
import { Button, Input, Pagination, Tag } from 'antd';
import type { PackagedSkillDescriptor } from '../../../plugins/skills/types';
import { skillKey } from '../../../plugins/skills/decode';
import { useSkillCopy } from './useSkillCopy';

interface Props { items: readonly PackagedSkillDescriptor[]; busy: boolean; onPreview: (skill: PackagedSkillDescriptor) => Promise<void> }
const PAGE_SIZE = 20;
export function PackagedSkillList({ items, busy, onPreview }: Props) {
  const t = useSkillCopy(); const [query, setQuery] = useState(''); const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => !needle || [item.name, item.description, item.pluginId, item.id].some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [items, query]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  return <div className="gonavi-packaged-skills-list">
    <Input.Search aria-label={t('plugin.skills.search')} placeholder={t('plugin.skills.search')} value={query}
      onChange={(event) => { setQuery(event.target.value); setPage(1); }} allowClear />
    <ul className="gonavi-packaged-skills-records" aria-label={t('plugin.skills.catalog')}>
      {filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((skill) => <li key={skillKey(skill)} className="gonavi-packaged-skill-record">
        <div className="gonavi-packaged-skill-heading"><strong>{skill.name}</strong>
          <Tag color={skill.available ? 'green' : undefined}>{skill.available ? t('plugin.skills.available') : t('plugin.skills.unavailable')}</Tag>
        </div>
        <p>{skill.description}</p>
        <div className="gonavi-packaged-skill-provenance"><code>{skill.pluginId} / {skill.id}</code><span>{t('plugin.skills.version')}: {skill.version}</span></div>
        {!skill.available && <span className="gonavi-packaged-skill-muted">{t('plugin.skills.unavailable_hint')}</span>}
        <div><Button disabled={!skill.available || busy} onClick={() => void onPreview(skill)}>{t('plugin.skills.preview')}</Button></div>
      </li>)}
    </ul>
    {filtered.length === 0 && <p className="gonavi-packaged-skill-muted">{t(query ? 'plugin.skills.no_matches' : 'plugin.skills.empty')}</p>}
    {filtered.length > PAGE_SIZE && <Pagination current={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} />}
  </div>;
}
