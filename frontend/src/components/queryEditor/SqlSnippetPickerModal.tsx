import React from 'react';
import { Button, Input } from 'antd';

import Modal from '../common/ResizableDraggableModal';

import { t as translate } from '../../i18n';
import type { SqlSnippet } from '../../types';

interface SqlSnippetPickerModalProps {
  open: boolean;
  darkMode: boolean;
  keyword: string;
  onKeywordChange: (value: string) => void;
  filteredSnippets: SqlSnippet[];
  emptyLabel: string;
  onInsertSnippet: (snippet: SqlSnippet) => void;
  onManageSnippets: () => void;
  onClose: () => void;
}

/** 查询编辑器“SQL 模板”选择弹窗：从 QueryEditor.tsx 抽出（债务文件净行数规约）。 */
const SqlSnippetPickerModal: React.FC<SqlSnippetPickerModalProps> = ({
  open,
  darkMode,
  keyword,
  onKeywordChange,
  filteredSnippets,
  emptyLabel,
  onInsertSnippet,
  onManageSnippets,
  onClose,
}) => (
      <Modal
        title={translate('query_editor.snippet_picker.title')}
        open={open}
        centered
        mask={false}
        maskClosable={false}
        width={620}
        draggable
        resizable
        minResizableWidth={460}
        minResizableHeight={320}
        onCancel={onClose}
        footer={null}
        styles={{
          content: {
            borderRadius: 16,
            border: darkMode ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(15,23,42,0.12)',
            background: darkMode ? 'rgba(18,18,20,0.98)' : 'rgba(255,255,255,0.98)',
            boxShadow: darkMode ? '0 24px 60px rgba(0,0,0,0.45)' : '0 24px 60px rgba(15,23,42,0.16)',
            backdropFilter: 'blur(12px)',
          },
          header: {
            background: 'transparent',
            borderBottom: 'none',
            paddingBottom: 8,
          },
          body: {
            paddingTop: 8,
            paddingBottom: 16,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          },
        }}
      >
        <div
          data-query-editor-snippet-picker="true"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            flex: '1 1 420px',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{ fontSize: 12, lineHeight: 1.6, color: darkMode ? 'rgba(255,255,255,0.65)' : 'rgba(16,24,40,0.6)' }}>
            {translate('query_editor.snippet_picker.description')}
          </div>
          <Input
            autoFocus
            data-query-editor-snippet-search="true"
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            onPressEnter={() => {
              if (filteredSnippets[0]) {
                onInsertSnippet(filteredSnippets[0]);
              }
            }}
            placeholder={translate('query_editor.snippet_picker.search_placeholder')}
          />
          <div
            style={{
              flex: '1 1 auto',
              minHeight: 0,
              overflowY: 'auto',
              paddingRight: 4,
              display: 'grid',
              gap: 8,
            }}
          >
            {filteredSnippets.map((snippet) => {
              const preview = String(snippet.description || snippet.syntaxHelp || snippet.body || '')
                .replace(/\s+/g, ' ')
                .trim();
              return (
                <button
                  key={snippet.id}
                  type="button"
                  data-query-editor-snippet-item={snippet.id}
                  onClick={() => onInsertSnippet(snippet)}
                  style={{
                    textAlign: 'left',
                    borderRadius: 12,
                    border: darkMode ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(15,23,42,0.1)',
                    background: darkMode ? 'rgba(255,255,255,0.03)' : '#fff',
                    padding: '12px 14px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--gn-font-mono)', fontSize: 12, fontWeight: 700, color: '#1677ff' }}>
                      {snippet.prefix}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.88)' }}>
                      {snippet.name}
                    </span>
                    {snippet.isBuiltin ? (
                      <span
                        style={{
                          fontSize: 11,
                          padding: '1px 8px',
                          borderRadius: 999,
                          background: darkMode ? 'rgba(22,119,255,0.18)' : 'rgba(22,119,255,0.1)',
                          color: '#1677ff',
                        }}
                      >
                        {translate('snippet_settings.tag.builtin')}
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      lineHeight: 1.6,
                      color: darkMode ? 'rgba(255,255,255,0.65)' : 'rgba(16,24,40,0.6)',
                      fontFamily: preview.includes('${') ? 'var(--gn-font-mono)' : undefined,
                    }}
                  >
                    {preview}
                  </div>
                </button>
              );
            })}
            {!filteredSnippets.length ? (
              <div
                data-query-editor-snippet-empty="true"
                style={{
                  borderRadius: 12,
                  padding: '18px 16px',
                  border: darkMode ? '1px dashed rgba(255,255,255,0.14)' : '1px dashed rgba(15,23,42,0.12)',
                  color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(16,24,40,0.55)',
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              >
                {emptyLabel}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <Button onClick={onManageSnippets}>
              {translate('query_editor.snippet_picker.manage')}
            </Button>
            <Button onClick={onClose}>
              {translate('common.cancel')}
            </Button>
          </div>
        </div>
      </Modal>

);

export default SqlSnippetPickerModal;
