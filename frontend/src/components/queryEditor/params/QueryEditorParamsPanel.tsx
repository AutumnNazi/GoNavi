import React from 'react';
import './queryEditorParams.css';
import { Empty, Modal, Spin } from 'antd';
import { useOptionalI18n } from '../../../i18n/provider';
import { t as defaultTranslate } from '../../../i18n';
import type { QueryParamInput, QueryParameterAnalysisInfo, QueryParamValueMap } from './queryEditorParamsModel';
import { QueryEditorParamFields } from './QueryEditorParamFields';

interface QueryEditorParamsPanelProps {
  analysis: QueryParameterAnalysisInfo | null;
  analyzing: boolean;
  values: QueryParamValueMap;
  onChange: (name: string, input: QueryParamInput | null) => void;
}

// 结果面板中的「参数」tab：会话级参数输入面板，重复执行时预填上次值。
export function QueryEditorParamsPanel(props: QueryEditorParamsPanelProps) {
  const { analysis, analyzing, values, onChange } = props;
  const { t } = useOptionalI18n() ?? { t: defaultTranslate };

  if (analyzing && !analysis) {
    return (
      <div className="gn-query-params-panel">
        <Spin size="small" />
      </div>
    );
  }
  if (!analysis || !analysis.supported) {
    return (
      <div className="gn-query-params-panel">
        <Empty
          description={t(analysis?.messageKey || 'query_editor.params.unsupported_driver')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }
  if ((analysis.parameterNames || []).length === 0) {
    return (
      <div className="gn-query-params-panel">
        <Empty
          description={t('query_editor.params.empty')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }
  return (
    <div className="gn-query-params-panel">
      <QueryEditorParamFields
        statements={analysis.statements}
        values={values}
        onChange={onChange}
      />
    </div>
  );
}

interface QueryEditorParamsBindDialogProps {
  open: boolean;
  analysis: QueryParameterAnalysisInfo | null;
  analyzing: boolean;
  values: QueryParamValueMap;
  missingNames: string[];
  onChange: (name: string, input: QueryParamInput | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

// 执行时的绑定参数对话框（对齐 DBeaver Bind parameter(s) 交互）。
export function QueryEditorParamsBindDialog(props: QueryEditorParamsBindDialogProps) {
  const { open, analysis, analyzing, values, missingNames, onChange, onConfirm, onCancel } = props;
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
