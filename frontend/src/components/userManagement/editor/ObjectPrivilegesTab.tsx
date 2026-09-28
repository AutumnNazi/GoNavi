import { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Select, Space, Tag, Tree } from 'antd';
import type { DataNode, EventDataNode } from 'antd/es/tree';
import { PlusOutlined } from '@ant-design/icons';
import { useI18n } from '../../../i18n/provider';
import { userManagementScopeLabel } from '../userManagementFieldLabels';
import type { PrincipalDraft } from '../userManagementDraft';
import type { UMGrant, UMServerProfile } from '../userManagementTypes';
import {
  describeTarget,
  grantedTargets,
  resolveObjectTreeLayout,
  splitQualifiedTable,
  tableTarget,
  targetFromKey,
  targetKey,
} from './objectPrivilegeTree';
import PrivilegeMatrix from './PrivilegeMatrix';

interface ObjectPrivilegesTabProps {
  profile: UMServerProfile;
  draft: PrincipalDraft;
  inherited: UMGrant[];
  writable: boolean;
  database: string;
  databases: string[];
  loadTables: (database: string) => Promise<string[]>;
  loadColumns: (database: string, table: string) => Promise<string[]>;
  onGrantsChange: (grants: UMGrant[]) => void;
}

const node = (target: UMGrant, title: string, isLeaf: boolean): DataNode => ({ key: targetKey(target), title, isLeaf });

/** 对象级权限：左侧对象树与已授权对象，右侧所选对象的权限矩阵。 */
export default function ObjectPrivilegesTab(props: ObjectPrivilegesTabProps) {
  const { profile, draft, inherited, writable, database, databases, loadTables, loadColumns, onGrantsChange } = props;
  const { t } = useI18n();
  const layout = resolveObjectTreeLayout(String(profile.family));
  const columnsEnabled = profile.objectScopes.includes('column');
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [manual, setManual] = useState<UMGrant>({ privilege: '', scope: profile.objectScopes[0] || 'table' });

  useEffect(() => {
    if (layout === 'database-schema') {
      setTreeData(database ? [node({ privilege: '', scope: 'database', database }, database, false)] : []);
      return;
    }
    const scope = layout === 'schema' ? 'schema' : 'database';
    setTreeData(databases.map((name) => node(scope === 'schema' ? { privilege: '', scope, schema: name } : { privilege: '', scope, database: name }, name, false)));
  }, [database, databases, layout]);

  const loadChildren = async (treeNode: EventDataNode<DataNode>) => {
    const target = targetFromKey(String(treeNode.key));
    let children: DataNode[] = [];
    if (target.scope === 'database' || target.scope === 'schema') {
      const container = target.scope === 'schema' ? String(target.schema) : String(target.database);
      const tables = await loadTables(container);
      if (layout === 'database-schema' && target.scope === 'database') {
        const schemas = Array.from(new Set(tables.map((name) => splitQualifiedTable(name).schema).filter(Boolean)));
        children = schemas.map((schema) => node({ privilege: '', scope: 'schema', database: container, schema }, schema, false));
        children.push(...tables.filter((name) => !splitQualifiedTable(name).schema).map((name) => node(tableTarget(layout, container, name), name, !columnsEnabled)));
      } else if (layout === 'database-schema') {
        const prefix = `${target.schema}.`;
        children = tables.filter((name) => name.startsWith(prefix)).map((name) => node(tableTarget(layout, String(target.database), name), splitQualifiedTable(name).table, !columnsEnabled));
      } else {
        children = tables.map((name) => node(tableTarget(layout, container, name), splitQualifiedTable(name).table || name, !columnsEnabled));
      }
    } else if (target.scope === 'table' && columnsEnabled) {
      const container = layout === 'schema' ? String(target.schema) : String(target.database);
      const qualified = layout === 'database-schema' && target.schema ? `${target.schema}.${target.object}` : String(target.object);
      const columns = await loadColumns(container, qualified);
      children = columns.map((column) => node({ ...target, scope: 'column', column }, column, true));
    }
    const attach = (nodes: DataNode[]): DataNode[] => nodes.map((item) => (item.key === treeNode.key
      ? { ...item, children }
      : { ...item, children: item.children ? attach(item.children) : item.children }));
    setTreeData((current) => attach(current));
  };

  const selected = selectedKey ? targetFromKey(selectedKey) : null;
  const privileges = useMemo(
    () => (selected ? profile.privileges.filter((item) => item.scopes.includes(selected.scope)) : []),
    [profile.privileges, selected],
  );
  const granted = grantedTargets(draft.grants);

  return (
    <div className="gn-user-mgmt-object-privileges">
      <div className="gn-user-mgmt-object-tree">
        {granted.length > 0 && (
          <div className="gn-user-mgmt-granted-targets">
            <div className="gn-user-mgmt-section-title">{t('user_management.privileges.granted_objects')}</div>
            {granted.map((target) => (
              <button key={targetKey(target)} type="button" className={`gn-user-mgmt-target-chip${targetKey(target) === selectedKey ? ' is-selected' : ''}`} onClick={() => setSelectedKey(targetKey(target))}>
                <Tag>{userManagementScopeLabel(target.scope, t)}</Tag>{describeTarget(target)}
              </button>
            ))}
          </div>
        )}
        {treeData.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('user_management.privileges.no_objects')} />
        ) : (
          <Tree treeData={treeData} loadData={loadChildren} selectedKeys={selectedKey ? [selectedKey] : []} onSelect={(keys) => setSelectedKey(String(keys[0] || ''))} blockNode />
        )}
        <div className="gn-user-mgmt-manual-target">
          <div className="gn-user-mgmt-section-title">{t('user_management.privileges.manual_title')}</div>
          <Space.Compact block>
            <Select value={manual.scope} style={{ width: 110 }} options={profile.objectScopes.map((scope) => ({ value: scope, label: userManagementScopeLabel(scope, t) }))} onChange={(scope) => setManual({ ...manual, scope })} />
            <Input placeholder={t('user_management.privileges.manual_placeholder')} value={describeTarget(manual) === '*' ? '' : [manual.database || manual.schema, manual.object].filter(Boolean).join('.')} onChange={(event) => {
              const [container = '', object = ''] = event.target.value.split('.');
              setManual(layout === 'schema' ? { ...manual, schema: container, object } : { ...manual, database: container || database, object });
            }} />
            {manual.scope === 'routine' && (
              <Select value={manual.objectType} placeholder={t('user_management.privileges.routine_type')} style={{ width: 120 }} options={['PROCEDURE', 'FUNCTION'].map((value) => ({ value, label: value }))} onChange={(objectType) => setManual({ ...manual, objectType })} />
            )}
            <Button icon={<PlusOutlined />} onClick={() => setSelectedKey(targetKey({ ...manual, privilege: '' }))} aria-label={t('user_management.privileges.manual_add')} />
          </Space.Compact>
        </div>
      </div>
      <div className="gn-user-mgmt-object-matrix">
        {selected ? (
          <>
            <div className="gn-user-mgmt-section-title">
              <Tag color="blue">{userManagementScopeLabel(selected.scope, t)}</Tag>{describeTarget(selected)}
            </div>
            <PrivilegeMatrix
              privileges={privileges}
              target={selected}
              grants={draft.grants}
              inherited={inherited}
              writable={writable}
              supportsGrantOption={profile.features.grantOption !== false}
              supportsDeny={profile.features.deny === true}
              onChange={onGrantsChange}
            />
          </>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('user_management.privileges.select_object')} />
        )}
      </div>
    </div>
  );
}
