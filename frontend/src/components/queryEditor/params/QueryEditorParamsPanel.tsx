import React from 'react';
import './queryEditorParams.css';
import { Empty, Modal, Spin, Switch } from 'antd';
import { useOptionalI18n } from '../../../i18n/provider';
import { t as defaultTranslate } from '../../../i18n';
import type { QueryParamInput, QueryParameterAnalysisInfo, QueryParamValueMap } from './queryEditorParamsModel';
import { QueryEditorParamFields } from './QueryEditorParamFields';

interface QuotedPlaceholderSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function QuotedPlaceholderSwitch({ enabled, onChange }: QuotedPlaceholderSwitchProps) {
  const { t } = useOptionalI18n() ?? { t: defaultTranslate };
  // 布局抄设置中心的 gonavi-settings-row：文字一列、控件一列，整行垂直居中，
  // 避免行内并排时开关与文字的基线错位。
  return (
    <div className="gn-query-params-quoted">
      <span className="gn-query-params-quoted-copy">
        <span className="gn-query-params-quoted-title">{t('query_editor.params.quoted_toggle')}</span>
        <span className="gn-query-params-quoted-hint">
          {t(enabled ? 'query_editor.params.quoted_toggle_on' : 'query_editor.params.quoted_toggle_off')}
        </span>
      </span>
      <Switch checked={enabled} onChange={onChange} />
    </div>
  );
}

interface QueryEditorParamsPanelProps {
  analysis: QueryParameterAnalysisInfo | null;
  analyzing: boolean;
  values: QueryParamValueMap;
  quotedPlaceholders: boolean;
  onQuotedPlaceholdersChange: (enabled: boolean) => void;
  onChange: (name: string, input: QueryParamInput | null) => void;
}

// 结果面板中的「参数」tab：会话级参数输入面板，重复执行时预填上次值。
export function QueryEditorParamsPanel(props: QueryEditorParamsPanelProps) {
  const { analysis, analyzing, values, quotedPlaceholders, onQuotedPlaceholdersChange, onChange } = props;
  const { t } = useOptionalI18n() ?? { t: defaultTranslate };
  let body: React.ReactNode;
  if (analyzing && !analysis) {
    body = <Spin size="small" />;
  } else if (!analysis || !analysis.supported) {
    body = (
      <Empty
        description={t(analysis?.messageKey || 'query_editor.params.unsupported_driver')}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  } else if ((analysis.parameterNames || []).length === 0) {
    body = (
      <Empty
        description={t('query_editor.params.empty')}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  } else {
    body = (
      <QueryEditorParamFields
        statements={analysis.statements}
        values={values}
        onChange={onChange}
      />
    );
  }
  return (
    <div className="gn-query-params-panel">
      <QuotedPlaceholderSwitch enabled={quotedPlaceholders} onChange={onQuotedPlaceholdersChange} />
      {body}
    </div>
  );
}

interface QueryEditorParamsBindDialogProps {
  open: boolean;
  analysis: QueryParameterAnalysisInfo | null;
  analyzing: boolean;
  values: QueryParamValueMap;
  missingNames: string[];
  quotedPlaceholders: boolean;
  onQuotedPlaceholdersChange: (enabled: boolean) => void;
  onChange: (name: string, input: QueryParamInput | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

// 执行时的绑定参数对话框（对齐 DBeaver Bind parameter(s) 交互）。
export function QueryEditorParamsBindDialog(props: QueryEditorParamsBindDialogProps) {
  const {
    open, analysis, analyzing, values, missingNames, quotedPlaceholders,
    onQuotedPlaceholdersChange, onChange, onConfirm, onCancel,
  } = props;
  const { t } = useOptionalI18n() ?? { t: defaultTranslate };

  return (
    <Modal
      open={open}
      title={t('query_editor.params.dialog_title')}
      okText={t('query_editor.params.execute')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: analyzing || missingNames.length > 0 }}
      onOk={onConfirm}
      onCancel={onCancel}
      width={560}
      destroyOnClose
    >
      {analyzing && !analysis ? (
        <Spin size="small" />
      ) : (
        <>
          <QuotedPlaceholderSwitch enabled={quotedPlaceholders} onChange={onQuotedPlaceholdersChange} />
          {missingNames.length > 0 && (
            <div className="gn-query-params-missing">
              {t('query_editor.params.missing_hint', { names: missingNames.join(', ') })}
            </div>
          )}
          {analysis && (
            <QueryEditorParamFields
              statements={analysis.statements}
              values={values}
              onChange={onChange}
              compact
            />
          )}
        </>
      )}
    </Modal>
  );
}
