import { useState, useMemo, useCallback } from 'react';
import Modal from './common/ResizableDraggableModal';
import { Button, Input, List, Tag, Popconfirm, message, Collapse, Typography } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  UndoOutlined,
  SaveOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';
import type { SqlSnippet } from '../types';
import { useStore } from '../store';
import { useI18n } from '../i18n/provider';
import { BUILTIN_SNIPPET_MAP } from '../utils/sqlSnippetDefaults';
import type { OverlayWorkbenchTheme } from '../utils/overlayWorkbenchTheme';
interface SnippetSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  embedded?: boolean;
}

type DraftSnippet = Omit<SqlSnippet, 'createdAt'> & { createdAt?: number };

const emptyDraft = (): DraftSnippet => ({
  id: uuidv4(),
  prefix: '',
  name: '',
  description: '',
  syntaxHelp: '',
  body: '',
  isBuiltin: false,
});

export default function SnippetSettingsModal({
  open,
  onClose,
  onBack,
  darkMode,
  overlayTheme,
  embedded = false,
}: SnippetSettingsModalProps) {
  const { t } = useI18n();
  const sqlSnippets = useStore((s) => s.sqlSnippets);
  const saveSqlSnippet = useStore((s) => s.saveSqlSnippet);
  const deleteSqlSnippet = useStore((s) => s.deleteSqlSnippet);
  const resetBuiltinSqlSnippet = useStore((s) => s.resetBuiltinSqlSnippet);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftSnippet>(emptyDraft());
  const [isCreating, setIsCreating] = useState(false);

  const shellStyle = useMemo(
    () => (
      embedded
        ? {
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
            backdropFilter: 'none',
          }
        : {
            background: overlayTheme.shellBg,
            border: overlayTheme.shellBorder,
            boxShadow: overlayTheme.shellShadow,
            backdropFilter: overlayTheme.shellBackdropFilter,
          }
    ),
    [embedded, overlayTheme],
  );

  const panelStyle = useMemo(
    () => (
      embedded
        ? {
            padding: '0 4px 0 16px',
            borderRadius: 0,
            border: 'none',
            background: 'transparent',
          }
        : {
            padding: 16,
            borderRadius: 14,
            border: overlayTheme.sectionBorder,
            background: overlayTheme.sectionBg,
          }
    ),
    [embedded, overlayTheme],
  );

  const textColor = darkMode ? 'rgba(255,255,255,0.85)' : 'rgba(16,24,40,0.9)';
  const mutedColor = darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)';
  const selectedBg = embedded
    ? overlayTheme.selectedBg
    : darkMode
      ? 'rgba(255,255,255,0.08)'
      : 'rgba(0,0,0,0.04)';
  const selectedRailColor = embedded ? overlayTheme.selectedText : overlayTheme.iconBg;
  const fieldLabelStyle = {
    fontSize: 12,
    lineHeight: 1.4,
    fontWeight: embedded ? 600 : 400,
    color: embedded ? textColor : mutedColor,
    marginBottom: embedded ? 6 : 4,
  };
  const newSnippetAction = t('snippet_settings.action.new');
  const snippetModalBodyMaxHeight = 'calc(100vh - 128px)';
  const snippetModalEmbeddedBodyMaxHeight = '100%';
  const snippetSyntaxReferenceMaxHeight = 'min(220px, 32vh)';

  const localizeBuiltinSnippet = useCallback((snippet: SqlSnippet): SqlSnippet => {
    if (!snippet.isBuiltin || !snippet.id.startsWith('builtin-')) {
      return snippet;
    }
    const key = snippet.id.slice('builtin-'.length);
    return {
      ...snippet,
      name: t(`sql_snippets.builtin.${key}.name`),
      description: t(`sql_snippets.builtin.${key}.description`),
    };
  }, [t]);

  const sortedSnippets = useMemo(
    () => sqlSnippets
      .map(localizeBuiltinSnippet)
      .sort((a, b) => a.prefix.localeCompare(b.prefix)),
    [localizeBuiltinSnippet, sqlSnippets],
  );

  const selectedSnippet = useMemo(
    () => sqlSnippets.find((s) => s.id === selectedId) ?? null,
    [sqlSnippets, selectedId],
  );

  const handleSelect = useCallback(
    (snippet: SqlSnippet) => {
      setIsCreating(false);
      setSelectedId(snippet.id);
      setDraft({ ...snippet });
    },
    [],
  );

  const handleNew = useCallback(() => {
    setIsCreating(true);
    setSelectedId(null);
    setDraft(emptyDraft());
  }, []);

  const handleSave = useCallback(() => {
    const prefix = draft.prefix.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    if (!prefix) {
      void message.warning(t('snippet_settings.message.prefix_required'));
      return;
    }
    if (!draft.name.trim()) {
      void message.warning(t('snippet_settings.message.name_required'));
      return;
    }
    if (!draft.body.trim()) {
      void message.warning(t('snippet_settings.message.body_required'));
      return;
    }

    const duplicate = sqlSnippets.find(
      (s) => s.prefix.toLowerCase() === prefix && s.id !== draft.id,
    );
    if (duplicate) {
      void message.warning(t('snippet_settings.message.prefix_duplicate', { prefix }));
      return;
    }

    const toSave: SqlSnippet = {
      id: draft.id,
      prefix,
      name: draft.name.trim(),
      description: draft.description?.trim() || undefined,
      syntaxHelp: draft.syntaxHelp?.trim() || undefined,
      body: draft.body,
      isBuiltin: draft.isBuiltin,
      createdAt: draft.createdAt ?? Date.now(),
    };

    saveSqlSnippet(toSave);
    setSelectedId(toSave.id);
    setIsCreating(false);
    void message.success(t('snippet_settings.message.saved'));
  }, [draft, sqlSnippets, saveSqlSnippet, t]);

  const handleDelete = useCallback(
    (id: string) => {
      deleteSqlSnippet(id);
      if (selectedId === id) {
        setSelectedId(null);
        setDraft(emptyDraft());
      }
      void message.success(t('snippet_settings.message.deleted'));
    },
    [deleteSqlSnippet, selectedId, t],
  );

  const handleReset = useCallback(
    (id: string) => {
      resetBuiltinSqlSnippet(id);
      const original = BUILTIN_SNIPPET_MAP[id];
      if (original && selectedId === id) {
        const localized = localizeBuiltinSnippet(original);
        setDraft({ ...localized, syntaxHelp: localized.syntaxHelp || '' });
      }
      void message.success(t('snippet_settings.message.reset_default'));
    },
    [localizeBuiltinSnippet, resetBuiltinSqlSnippet, selectedId, t],
  );

  const syntaxHelpItems = useMemo(
    () => [
      {
        key: 'snippet-help',
        label: t('snippet_settings.syntax_help.label'),
        children: (
          <Input.TextArea
            data-sql-snippet-syntax-help-editor="true"
            value={draft.syntaxHelp || ''}
            onChange={(e) => setDraft((d) => ({ ...d, syntaxHelp: e.target.value }))}
            placeholder={t('snippet_settings.syntax_help.placeholder')}
            maxLength={1000}
            autoSize={{ minRows: 4, maxRows: 8 }}
            style={{
              fontSize: 12,
              resize: 'none',
              fontFamily: embedded ? 'var(--gn-font-sans)' : 'var(--gn-font-mono)',
            }}
          />
        ),
      },
      {
        key: 'syntax',
        label: t('snippet_settings.syntax_reference.label'),
        children: (
          <div
            data-sql-snippet-syntax-reference-scroll-region="true"
            style={{
              maxHeight: snippetSyntaxReferenceMaxHeight,
              overflowY: 'auto',
              overflowX: 'hidden',
              overscrollBehavior: 'contain',
              paddingRight: 6,
              fontSize: 12,
              lineHeight: 1.8,
              color: mutedColor,
              fontFamily: embedded ? 'var(--gn-font-sans)' : 'var(--gn-font-mono)',
            }}
          >
            <div>{t('snippet_settings.syntax_reference.first_tabstop')}</div>
            <div>{t('snippet_settings.syntax_reference.second_tabstop')}</div>
            <div>{t('snippet_settings.syntax_reference.final_cursor')}</div>
            <div>{t('snippet_settings.syntax_reference.linked_tabstop')}</div>
            <div style={{ marginTop: 6, fontWeight: 600, color: textColor }}>{t('snippet_settings.syntax_reference.builtin_variables')}</div>
            <div>{t('snippet_settings.syntax_reference.current_date')}</div>
            <div>{t('snippet_settings.syntax_reference.current_time')}</div>
            <div>{t('snippet_settings.syntax_reference.unix_seconds')}</div>
            <div>{t('snippet_settings.syntax_reference.uuid')}</div>
            <div>{t('snippet_settings.syntax_reference.random')}</div>
            <div style={{ marginTop: 8, fontFamily: 'inherit', color: textColor }}>
              {t('snippet_settings.syntax_reference.example')}
            </div>
          </div>
        ),
      },
    ],
    [draft.syntaxHelp, embedded, mutedColor, snippetSyntaxReferenceMaxHeight, t, textColor],
  );

  const showEditor = isCreating || selectedSnippet;

  const resetAction = showEditor && draft.isBuiltin && draft.createdAt ? (
    <Popconfirm
      title={t('snippet_settings.confirm.reset.title')}
      description={t('snippet_settings.confirm.reset.description')}
      onConfirm={() => handleReset(draft.id)}
    >
      <Button
        icon={<UndoOutlined />}
        size="middle"
        style={{ minWidth: embedded ? 96 : 104, marginRight: embedded ? 'auto' : undefined }}
      >
        {t('snippet_settings.action.reset')}
      </Button>
    </Popconfirm>
  ) : null;

  const deleteAction = showEditor && !draft.isBuiltin && !isCreating ? (
    <Popconfirm
      title={t('snippet_settings.confirm.delete.title')}
      description={t('snippet_settings.confirm.delete.description')}
      onConfirm={() => handleDelete(draft.id)}
    >
      <Button
        danger
        icon={<DeleteOutlined />}
        size="middle"
        style={{ minWidth: 84, marginRight: embedded ? 'auto' : undefined }}
      >
        {t('snippet_settings.action.delete')}
      </Button>
    </Popconfirm>
  ) : null;

  const saveAction = showEditor ? (
    <Button
      type="primary"
      icon={<SaveOutlined />}
      size="middle"
      style={{ minWidth: 84 }}
      onClick={handleSave}
    >
      {t('snippet_settings.action.save')}
    </Button>
  ) : null;

  const closeAction = (
    <Button
      type={embedded && !showEditor ? 'primary' : undefined}
      size="middle"
      style={{ minWidth: 84 }}
      onClick={onClose}
    >
      {t('snippet_settings.action.close')}
    </Button>
  );

  const backAction = onBack ? (
    <Button size="middle" style={{ minWidth: embedded ? 96 : 104 }} onClick={onBack}>
      {t(embedded ? 'common.back_to_settings' : 'common.back_to_previous')}
    </Button>
  ) : null;

  return (
    <Modal
      title={embedded ? null : (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              display: 'grid',
              placeItems: 'center',
              background: overlayTheme.iconBg,
              color: overlayTheme.iconColor,
              flexShrink: 0,
            }}
          >
            <CodeOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: textColor }}>{t('app.tools.entry.snippets.title')}</div>
            <div style={{ fontSize: 12, color: mutedColor, lineHeight: 1.5 }}>
              {t('app.tools.entry.snippets.description')}
            </div>
          </div>
        </div>
      )}
      open={open}
      embedded={embedded}
      closable={embedded ? false : undefined}
      onCancel={onClose}
      width={820}
      styles={{
        content: shellStyle,
        header: { background: 'transparent', borderBottom: 'none', paddingBottom: 8 },
        body: {
          paddingTop: 8,
          paddingBottom: 0,
          display: 'flex',
          flexDirection: 'column',
          height: embedded ? '100%' : undefined,
          maxHeight: embedded ? snippetModalEmbeddedBodyMaxHeight : snippetModalBodyMaxHeight,
          minHeight: 0,
          overflow: 'hidden',
        },
      }}
      footer={null}
    >
      <div
        data-sql-snippet-content-region="true"
        style={{
          display: 'flex',
          gap: embedded ? 0 : 16,
          flex: embedded ? '1 1 0' : '1 1 420px',
          minHeight: 0,
          overflow: 'hidden',
          borderTop: embedded ? overlayTheme.sectionBorder : undefined,
          fontFamily: embedded ? 'var(--gn-font-sans)' : undefined,
        }}
      >
        {/* Left: snippet list */}
        <div
          data-sql-snippet-master-panel="true"
          style={{
            width: embedded ? 196 : 220,
            flexShrink: 0,
            minHeight: 0,
            borderRadius: embedded ? 0 : 14,
            border: embedded ? 'none' : overlayTheme.sectionBorder,
            borderRight: embedded ? overlayTheme.sectionBorder : undefined,
            background: embedded ? 'transparent' : overlayTheme.sectionBg,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: embedded ? '10px 10px 8px' : '8px 12px 4px',
              fontSize: 12,
              lineHeight: 1.4,
              color: embedded ? textColor : mutedColor,
              fontWeight: 600,
              borderBottom: embedded ? overlayTheme.sectionBorder : undefined,
            }}
          >
            {t('snippet_settings.list.title')}
          </div>
          <div role={embedded ? 'listbox' : undefined} style={{ flex: 1, overflowY: 'auto' }}>
            <List
              size="small"
              dataSource={sortedSnippets}
              renderItem={(snippet) => (
                <List.Item
                  onClick={() => handleSelect(snippet)}
                  onKeyDown={embedded ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleSelect(snippet);
                      return;
                    }
                    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                      event.preventDefault();
                      const options = Array.from(
                        event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
                      );
                      const currentIndex = options.indexOf(event.currentTarget);
                      const nextIndex = event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? options.length - 1
                          : event.key === 'ArrowDown'
                            ? Math.min(options.length - 1, currentIndex + 1)
                            : Math.max(0, currentIndex - 1);
                      const nextSnippet = sortedSnippets[nextIndex];
                      if (nextSnippet) {
                        handleSelect(nextSnippet);
                        options[nextIndex]?.focus();
                      }
                    }
                  } : undefined}
                  role={embedded ? 'option' : undefined}
                  aria-selected={embedded ? selectedId === snippet.id : undefined}
                  tabIndex={embedded
                    ? selectedId === snippet.id || (!selectedId && sortedSnippets[0]?.id === snippet.id) ? 0 : -1
                    : undefined}
                  style={{
                    cursor: 'pointer',
                    minHeight: embedded ? 40 : undefined,
                    padding: embedded ? '7px 10px' : '6px 12px',
                    background: selectedId === snippet.id ? selectedBg : 'transparent',
                    borderLeft:
                      selectedId === snippet.id
                        ? `3px solid ${selectedRailColor}`
                        : '3px solid transparent',
                    borderBottom: embedded ? overlayTheme.sectionBorder : undefined,
                    transition: 'background-color 0.15s ease, color 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, width: '100%', overflow: 'hidden' }}>
                    {embedded ? (
                      <code
                        style={{
                          flexShrink: 0,
                          color: selectedId === snippet.id ? overlayTheme.selectedText : textColor,
                          fontFamily: 'var(--gn-font-mono)',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {snippet.prefix}
                      </code>
                    ) : (
                      <Typography.Text
                        code
                        style={{ fontSize: 12, flexShrink: 0, color: textColor }}
                      >
                        {snippet.prefix}
                      </Typography.Text>
                    )}
                    <span
                      style={{
                        minWidth: 0,
                        fontSize: embedded ? 13 : 12,
                        color: textColor,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {snippet.name}
                    </span>
                    {snippet.isBuiltin && (
                      <Tag
                        style={{
                          fontSize: 10,
                          lineHeight: '16px',
                          padding: '0 4px',
                          margin: 0,
                          borderRadius: 4,
                          ...(embedded
                            ? {
                                border: 'none',
                                background: overlayTheme.selectedBg,
                                color: overlayTheme.selectedText,
                              }
                            : {}),
                        }}
                        color={embedded ? undefined : 'blue'}
                      >
                        {t('snippet_settings.tag.builtin')}
                      </Tag>
                    )}
                  </div>
                </List.Item>
              )}
            />
          </div>
          <div
            style={{
              padding: embedded ? '8px 8px 0' : 8,
              borderTop: embedded ? overlayTheme.sectionBorder : undefined,
            }}
          >
            <Button
              type={embedded ? 'text' : 'dashed'}
              icon={<PlusOutlined />}
              block
              size={embedded ? 'middle' : 'small'}
              style={embedded ? { justifyContent: 'flex-start', borderRadius: 6 } : undefined}
              onClick={handleNew}
            >
              {newSnippetAction}
            </Button>
          </div>
        </div>

        {/* Right: editor */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          {showEditor ? (
            <div
              style={{
                ...panelStyle,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                overscrollBehavior: 'contain',
                paddingRight: embedded ? 4 : 12,
              }}
              data-sql-snippet-editor-panel-scroll-region="true"
            >
              <div style={{ display: 'flex', gap: embedded ? 16 : 12, flex: '0 0 auto' }}>
                <div style={{ flex: 0.4 }}>
                  <div style={fieldLabelStyle}>{t('snippet_settings.field.prefix.label')}</div>
                  <Input
                    value={draft.prefix}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, prefix: e.target.value.toLowerCase() }))
                    }
                    placeholder={t('snippet_settings.field.prefix.placeholder')}
                    maxLength={20}
                    size={embedded ? 'middle' : 'small'}
                  />
                </div>
                <div style={{ flex: 0.6 }}>
                  <div style={fieldLabelStyle}>{t('snippet_settings.field.name.label')}</div>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder={t('snippet_settings.field.name.placeholder')}
                    maxLength={60}
                    size={embedded ? 'middle' : 'small'}
                  />
                </div>
              </div>

              <div style={{ flex: '0 0 auto', marginTop: embedded ? 14 : 10 }}>
                <div style={fieldLabelStyle}>{t('snippet_settings.field.description.label')}</div>
                <Input
                  value={draft.description || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder={t('snippet_settings.field.description.placeholder')}
                  maxLength={200}
                  size={embedded ? 'middle' : 'small'}
                />
              </div>

              <div
                data-sql-snippet-editor-scroll-region="true"
                style={{
                  flex: '0 0 auto',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  marginTop: embedded ? 14 : 10,
                }}
              >
                <div style={fieldLabelStyle}>{t('snippet_settings.field.body.label')}</div>
                <Input.TextArea
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  placeholder={'SELECT ${1:columns} FROM ${2:table_name}$0;'}
                  style={{
                    height: 220,
                    minHeight: 160,
                    maxHeight: 260,
                    fontFamily: 'var(--gn-font-mono)',
                    fontSize: 13,
                    resize: 'none',
                  }}
                />
                <Collapse
                  size="small"
                  ghost={embedded}
                  defaultActiveKey={['snippet-help']}
                  items={syntaxHelpItems}
                  style={{
                    marginTop: embedded ? 12 : 8,
                    background: 'transparent',
                    borderRadius: embedded ? 0 : undefined,
                    borderTop: embedded ? overlayTheme.sectionBorder : undefined,
                    flex: '0 0 auto',
                  }}
                />
              </div>

            </div>
          ) : (
            <div
              style={{
                ...panelStyle,
                display: 'grid',
                placeItems: 'center',
                height: '100%',
                color: mutedColor,
                fontSize: 13,
              }}
            >
              {t('snippet_settings.empty_state', { action: newSnippetAction })}
            </div>
          )}
        </div>
      </div>
      <div
        data-sql-snippet-action-row="true"
        style={{
          display: 'flex',
          flex: '0 0 auto',
          gap: embedded ? 8 : 10,
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingTop: embedded ? 12 : 8,
          marginTop: embedded ? 0 : 8,
          borderTop: overlayTheme.sectionBorder,
          fontFamily: embedded ? 'var(--gn-font-sans)' : undefined,
        }}
      >
        {embedded ? (
          <>
            {resetAction}
            {deleteAction}
            {backAction}
            {closeAction}
            {saveAction}
          </>
        ) : (
          <>
            {resetAction}
            {deleteAction}
            {saveAction}
            {closeAction}
            {backAction}
          </>
        )}
      </div>
    </Modal>
  );
}
