import React, { useMemo, useState } from 'react';
import { invokeAppMethodDynamic } from '../../utils/webRpc';
import { Button, Empty, Input, Modal, Switch, Tag } from 'antd';

import { t as translate } from '../../i18n';
import type { SavedConnection } from '../../types';
import {
  buildDuckDBAttachStatementText,
  isDuckDBAttachableConnection,
  slugifyDuckDBAttachAlias,
} from './duckdbAttachStatement';

export interface DuckDBAttachedDatasource {
  alias: string;
  connectionId?: string;
  kind: string;
  readOnly: boolean;
}

interface DuckDBAttachPickerModalProps {
  open: boolean;
  connections: SavedConnection[];
  darkMode: boolean;
  /** 宿主 DuckDB 连接配置，用于查询当前会话的附加状态。 */
  hostConnectionConfig?: unknown;
  hostDbName?: string;
  onClose: () => void;
  /** 选中连接并点击插入后回调，statement 为构造好的 ATTACH 语句文本。 */
  onInsert: (statement: string) => void;
}

/**
 * DuckDB“附加已保存数据源”选择器（issue #1270）：
 * 用户按名称挑选连接、确认别名与只读模式，插入的语句只含连接 ID，不含任何凭据。
 */
const DuckDBAttachPickerModal: React.FC<DuckDBAttachPickerModalProps> = ({
  open,
  connections,
  darkMode,
  hostConnectionConfig,
  hostDbName,
  onClose,
  onInsert,
}) => {
  const [keyword, setKeyword] = useState('');
  const [attachedList, setAttachedList] = useState<DuckDBAttachedDatasource[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [alias, setAlias] = useState('');
  const [readOnly, setReadOnly] = useState(true);

  // 弹窗打开时查询宿主会话的附加状态：卡片显示“已附加 → 别名”，
  // 选中已附加连接时自动沿用其别名与只读模式（用户无需记忆上次设置）。
  React.useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        let result: DuckDBAttachedDatasource[] = [];
        const viaBridge = await invokeAppMethodDynamic<DuckDBAttachedDatasource[]>('ListDuckDBAttachedDatasources', [hostConnectionConfig ?? null, hostDbName ?? '']);
        if (Array.isArray(viaBridge)) {
          result = viaBridge;
        } else {
          const dynamic = (window as unknown as { go?: { app?: { App?: { ListDuckDBAttachedDatasources?: (c: unknown, d: string) => Promise<DuckDBAttachedDatasource[]> } } } }).go?.app?.App;
          if (typeof dynamic?.ListDuckDBAttachedDatasources === 'function') {
            result = await dynamic.ListDuckDBAttachedDatasources(hostConnectionConfig ?? null, hostDbName ?? '');
          }
        }
        if (!cancelled && Array.isArray(result)) {
          setAttachedList(result);
        }
      } catch {
        if (!cancelled) {
          setAttachedList([]);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, hostConnectionConfig, hostDbName]);
  const filtered = useMemo(() => {
    const keywordText = keyword.trim().toLowerCase();
    const items = [...connections].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    if (!keywordText) {
      return items;
    }
    return items.filter((item) =>
      String(item.name || '').toLowerCase().includes(keywordText)
      || String(item.id || '').toLowerCase().includes(keywordText));
  }, [connections, keyword]);

  const attachedByConnectionId = useMemo(() => {
    const map = new Map<string, DuckDBAttachedDatasource>();
    for (const item of attachedList) {
      if (item.connectionId) {
        map.set(item.connectionId, item);
      }
    }
    return map;
  }, [attachedList]);

  const selected = useMemo(
    () => connections.find((item) => item.id === selectedId) || null,
    [connections, selectedId],
  );
  const selectedAttachable = !!selected && isDuckDBAttachableConnection(selected?.config);

  const statement = useMemo(() => {
    if (!selected || !selectedAttachable) {
      return '';
    }
    return buildDuckDBAttachStatementText({
      connectionId: selected.id,
      alias: alias.trim() || undefined,
      readOnly,
    });
  }, [selected, selectedAttachable, alias, readOnly]);

  const handleSelect = (connection: SavedConnection) => {
    setSelectedId(connection.id);
    // 每次切换选中都重置派生：已附加的沿用其别名与模式，未附加的按名称重派生
    const attached = attachedByConnectionId.get(connection.id);
    if (attached) {
      setAlias(attached.alias);
      setReadOnly(attached.readOnly);
      return;
    }
    setAlias(slugifyDuckDBAttachAlias(connection.name, connection.id));
  };

  const handleClose = () => {
    setKeyword('');
    setSelectedId('');
    setAlias('');
    setReadOnly(true);
    onClose();
  };

  // 测试环境（窄 mock）与真实 antd 的 Modal 行为差异：open=false 时不执行渲染体
  if (!open) {
    return null;
  }
  const mutedColor = darkMode ? 'rgba(255,255,255,0.65)' : 'rgba(16,24,40,0.6)';
  const borderColor = darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.1)';

  return (
    <Modal
      title={translate('query_editor.duckdb_attach.title')}
      open={open}
      centered
      width={560}
      onCancel={handleClose}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          {translate('common.cancel')}
        </Button>,
        <Button
          key="insert"
          type="primary"
          data-duckdb-attach-insert="true"
          disabled={!statement}
          onClick={() => {
            if (!statement) {
              return;
            }
            onInsert(statement);
            handleClose();
          }}
        >
          {translate('query_editor.duckdb_attach.insert')}
        </Button>,
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, lineHeight: 1.6, color: mutedColor }}>
          {translate('query_editor.duckdb_attach.description')}
        </div>
        <Input
          autoFocus
          data-duckdb-attach-search="true"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={translate('query_editor.duckdb_attach.search_placeholder')}
          allowClear
        />
        <div
          style={{
            maxHeight: 260,
            overflowY: 'auto',
            display: 'grid',
            gap: 8,
            paddingRight: 4,
          }}
        >
          {filtered.length === 0 ? (
            <Empty description={translate('query_editor.duckdb_attach.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            filtered.map((connection) => {
              const attachable = isDuckDBAttachableConnection(connection.config);
              const isSelected = connection.id === selectedId;
              return (
                <button
                  key={connection.id}
                  type="button"
                  data-duckdb-attach-item={connection.id}
                  disabled={!attachable}
                  onClick={() => handleSelect(connection)}
                  style={{
                    textAlign: 'left',
                    borderRadius: 10,
                    border: `1px solid ${isSelected ? '#1677ff' : borderColor}`,
                    background: darkMode ? 'rgba(255,255,255,0.03)' : '#fff',
                    padding: '10px 12px',
                    cursor: attachable ? 'pointer' : 'not-allowed',
                    opacity: attachable ? 1 : 0.55,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.88)' }}>
                      {connection.name || connection.id}
                    </span>
                    <Tag style={{ marginRight: 0 }}>{String(connection.config?.type || '')}</Tag>
                    {!attachable && (
                      <span style={{ fontSize: 11, color: mutedColor }}>
                        {translate('query_editor.duckdb_attach.unsupported_type')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: mutedColor, marginTop: 4, fontFamily: 'var(--gn-font-mono)' }}>
                    {connection.id}
                  </div>
                  {attachedByConnectionId.get(connection.id) ? (
                    <div style={{ marginTop: 4 }}>
                      <Tag color="green" style={{ marginRight: 0 }}>
                        {translate('query_editor.duckdb_attach.attached_badge', {
                          alias: attachedByConnectionId.get(connection.id)!.alias,
                        })}
                      </Tag>
                    </div>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            {translate('query_editor.duckdb_attach.read_only')}
            <Switch size="small" checked={readOnly} onChange={setReadOnly} />
          </label>
          <Input
            data-duckdb-attach-alias="true"
            value={alias}
            onChange={(event) => {
              setAlias(event.target.value);
            }}
            placeholder={translate('query_editor.duckdb_attach.alias_placeholder')}
            style={{ flex: '1 1 200px' }}
            allowClear
          />
        </div>
      </div>
    </Modal>
  );
};

export default DuckDBAttachPickerModal;
