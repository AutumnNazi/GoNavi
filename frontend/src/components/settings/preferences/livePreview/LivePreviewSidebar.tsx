import { Input, Tree, type InputRef } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { GnDatabaseIcon, GnFolderOpenIcon, GnSearchIcon, GnTableIcon } from '../../../icons/gnIcons';
import { useOptionalI18n } from '../../../../i18n/provider';
import { t as defaultTranslate } from '../../../../i18n';

const EXPANDED_KEYS = ['connection', 'database', 'tables'];
type Props = { mode: 'classic' | 'navicat'; table: string; connectionName: string; onSelect: (table: string) => void; searchFocus: number; revealTable: number };
export function LivePreviewSidebar({ mode, table, connectionName, onSelect, searchFocus, revealTable }: Props) {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const [filter, setFilter] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>(EXPANDED_KEYS);
  const input = useRef<InputRef>(null);
  useEffect(() => { if (searchFocus > 0) input.current?.focus({ preventScroll: true }); }, [searchFocus]);
  useEffect(() => { if (revealTable > 0) { setFilter(''); setExpandedKeys(EXPANDED_KEYS); } }, [revealTable]);
  return <aside className="gn-v2-app-sider gn-v2-sidebar-redesign gn-live-sidebar">
    <div className="gn-live-sidebar-heading"><strong>{connectionName}</strong></div>
    <Input ref={input} size="small" prefix={<GnSearchIcon />} placeholder={t('settings.preview.filter')} value={filter} onChange={event => setFilter(event.target.value)} allowClear />
    <Tree showIcon blockNode expandedKeys={expandedKeys} onExpand={setExpandedKeys} selectedKeys={[table]} className="gn-v2-tree"
      onSelect={keys => { if (keys[0] === 'orders' || keys[0] === 'customers') onSelect(String(keys[0])); }}
      treeData={[{ key: 'connection', title: connectionName, icon: <GnDatabaseIcon />, children: [
        { key: 'database', title: 'sales', icon: <GnDatabaseIcon />, children: [
          { key: 'tables', title: t('sidebar.object_group.tables'), icon: <GnFolderOpenIcon />, children: ['orders', 'customers'].filter(name => name.includes(filter.toLowerCase())).map(name => ({ key: name, title: name, icon: <GnTableIcon />, isLeaf: true })) },
        ] },
      ] }]} />
    {mode === 'navicat' && <div className="gn-side-info-tabs gn-live-sidebar-info"><div className="gn-live-info-tabs">{t('settings.preview.object_info')}</div>
      <strong>{table}</strong><small>sales</small><span>MySQL · InnoDB</span></div>}
  </aside>;
}
