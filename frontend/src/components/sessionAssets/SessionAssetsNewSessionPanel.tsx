import React from 'react';
import { Alert, Button, Input, InputNumber, message, Modal, Radio, Space, Spin } from 'antd';
import { t } from '../../i18n';
import type { SessionAssetDetail, SessionAssetsApi } from './sessionAssetsApi';

/**
 * 携带历史新建的两阶段面板（交互设计 §6）：阶段一选择材料范围与目标，
 * 阶段二预览历史引用与省略说明后交接。提交按钮按真实动作命名；
 * 入口启动不显示为会话已创建（V-29）。
 */
export const SessionAssetsNewSessionPanel: React.FC<{
  detail: SessionAssetDetail;
  api: SessionAssetsApi;
  onClose: () => void;
}> = ({ detail, api, onClose }) => {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [mode, setMode] = React.useState<'recent' | 'all' | 'custom'>('recent');
  const [from, setFrom] = React.useState<number>(0);
  const [to, setTo] = React.useState<number>(-1);
  const [workDir, setWorkDir] = React.useState(detail.projectDir || '');
  const [currentRequest, setCurrentRequest] = React.useState('');
  const [preview, setPreview] = React.useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [resultNote, setResultNote] = React.useState('');

  const loadPreview = React.useCallback(async () => {
    setBusy(true);
    try {
      const data = await api.previewHandoff(detail.id, mode, from, to);
      setPreview(data);
    } finally {
      setBusy(false);
    }
  }, [api, detail.id, from, mode, to]);

  React.useEffect(() => {
    if (step === 2 && !preview) {
      void loadPreview();
    }
  }, [step, preview, loadPreview]);

  const handlePrepare = React.useCallback(async () => {
    setBusy(true);
    try {
      const plan = await api.prepareHandoff(detail.id, workDir, mode, from, to);
      if (plan?.stage === 'materials_ready') {
        setResultNote(t('session_assets.handoff.materials_ready', { file: plan.noteFile || plan.materialsDir || '' }));
        if (workDir) {
          const launch = await api.launchInteractive(workDir);
          if (launch?.stage === 'entry_launched') {
            message.info(t('session_assets.handoff.entry_launched'));
          }
        }
      } else {
        message.warning(t('session_assets.handoff.materials_failed'));
      }
    } finally {
      setBusy(false);
    }
  }, [api, detail.id, mode, from, to, workDir]);

  const stats = (preview?.stats ?? null) as { messages?: number; toolCalls?: number; opaque?: number } | null;
  return (
    <Modal
      open
      title={t('session_assets.new_session.title', { title: detail.title || detail.nativeThreadId })}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnHidden
    >
      <div data-session-assets-new-session="true" className="session-assets-new-session">
        {step === 1 ? (
          <>
            <SectionLabel label={t('session_assets.new_session.scope_label')} />
            <Radio.Group
              value={mode}
              onChange={(event) => setMode(event.target.value)}
              options={[
                { value: 'recent', label: t('session_assets.new_session.scope_recent') },
                { value: 'all', label: t('session_assets.new_session.scope_all') },
                { value: 'custom', label: t('session_assets.new_session.scope_custom') },
              ]}
            />
            {mode === 'custom' ? (
              <Space className="session-assets-new-session-range">
                <InputNumber min={0} value={from} onChange={(value) => setFrom(Number(value ?? 0))} aria-label={t('session_assets.new_session.range_from')} />
                <InputNumber min={-1} value={to} onChange={(value) => setTo(Number(value ?? -1))} aria-label={t('session_assets.new_session.range_to')} />
              </Space>
            ) : null}
            <SectionLabel label={t('session_assets.new_session.workdir_label')} />
            <Input value={workDir} onChange={(event) => setWorkDir(event.target.value)} placeholder={t('session_assets.new_session.workdir_hint')} />
            <SectionLabel label={t('session_assets.new_session.request_label')} />
            <Input.TextArea
              rows={3}
              value={currentRequest}
              onChange={(event) => setCurrentRequest(event.target.value)}
              placeholder={t('session_assets.new_session.request_hint')}
            />
            <div className="session-assets-new-session-actions">
              <Button onClick={onClose}>{t('common.cancel')}</Button>
              <Button type="primary" onClick={() => setStep(2)}>
                {t('session_assets.new_session.preview_action')}
              </Button>
            </div>
          </>
        ) : (
          <>
            {busy && !preview ? (
              <Spin />
            ) : (
              <>
                <Alert
                  type="info"
                  showIcon
                  message={t('session_assets.new_session.preview_title')}
                  description={
                    <ul className="session-assets-new-session-preview">
                      <li>{t('session_assets.new_session.preview_range', {
                        from: String(preview?.resolvedFrom ?? preview?.from ?? from),
                        to: String(preview?.resolvedTo ?? preview?.to ?? to),
                      })}</li>
                      {stats ? (
                        <li>{t('session_assets.new_session.preview_stats', {
                          messages: String(stats.messages ?? 0),
                          toolCalls: String(stats.toolCalls ?? 0),
                        })}</li>
                      ) : null}
                      {preview?.omissions ? <li>{String(preview.omissions)}</li> : null}
                      <li>{t('session_assets.new_session.preview_budget')}</li>
                      {currentRequest ? <li>{t('session_assets.new_session.preview_request', { request: currentRequest })}</li> : null}
                    </ul>
                  }
                />
                <Alert
                  type="warning"
                  showIcon
                  message={t('session_assets.new_session.launch_notice')}
                  className="session-assets-new-session-notice"
                />
                <div className="session-assets-new-session-actions">
                  <Button onClick={() => setStep(1)}>{t('common.back_to_previous')}</Button>
                  <Button onClick={() => void handlePrepare()} disabled={busy} loading={busy}>
                    {t('session_assets.new_session.prepare_action')}
                  </Button>
                </div>
                {resultNote ? <Alert type="success" showIcon message={resultNote} /> : null}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

const SectionLabel: React.FC<{ label: string }> = ({ label }) => (
  <div className="session-assets-new-session-label">{label}</div>
);
