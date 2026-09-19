import React, { useMemo, useState } from 'react';
import { Button, Empty, Input, Modal, Switch, Tag } from 'antd';

import { t as translate } from '../../i18n';
import type { SavedConnection } from '../../types';
import {
  buildDuckDBAttachStatementText,
  isDuckDBAttachableConnectionType,
  slugifyDuckDBAttachAlias,
} from './duckdbAttachStatement';

interface DuckDBAttachPickerModalProps {
  open: boolean;
  connections: SavedConnection[];
  darkMode: boolean;
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
  onClose,
  onInsert,
}) => {
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [alias, setAlias] = useState('');
  const [aliasEdited, setAliasEdited] = useState(false);
  const [readOnly, setReadOnly] = useState(true);

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

  const selected = useMemo(
    () => connections.find((item) => item.id === selectedId) || null,
    [connections, selectedId],
  );
  const selectedAttachable = !!selected && isDuckDBAttachableConnectionType(selected.config?.type);

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
    if (!aliasEdited) {
      setAlias(slugifyDuckDBAttachAlias(connection.name, connection.id));
    }
  };

  const handleClose = () => {
    setKeyword('');
    setSelectedId('');
    setAlias('');
    setAliasEdited(false);
    setReadOnly(true);
    onClose();
  };

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
              const attachable = isDuckDBAttachableConnectionType(connection.config?.type);
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
              setAliasEdited(true);
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
