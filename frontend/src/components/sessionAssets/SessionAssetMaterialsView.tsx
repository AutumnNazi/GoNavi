import React from 'react';
import { Alert, Empty, Tag } from 'antd';
import { t } from '../../i18n';
import type { SessionAssetDetail } from './sessionAssetsApi';

/**
 * 材料视图：说明当前可利用的材料（原始记录、祖先依赖、附件）与缺失项
 * （交互设计 §5.3）。这是完整性说明入口，不是多版本管理页面。
 */
export const SessionAssetMaterialsView: React.FC<{ detail: SessionAssetDetail }> = ({ detail }) => {
  if (!detail.hasBackup) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('session_assets.materials.none')} />;
  }
  return (
    <div className="session-assets-materials" data-session-assets-materials="true">
      <Section title={t('session_assets.materials.files')}>
        {detail.materialFiles.length === 0 ? (
          <span className="session-assets-materials-empty">{t('session_assets.materials.none')}</span>
        ) : (
          detail.materialFiles.map((file) => (
            <div key={file.relPath} className="session-assets-materials-row">
              <code>{file.relPath}</code>
              <Tag>{file.role}</Tag>
              <span className="session-assets-materials-size">{formatSize(file.size)}</span>
            </div>
          ))
        )}
      </Section>
      <Section title={t('session_assets.materials.ancestors')}>
        {detail.ancestors.length === 0 ? (
          <span className="session-assets-materials-empty">{t('session_assets.materials.no_ancestors')}</span>
        ) : (
          detail.ancestors.map((ancestor) => (
            <div key={ancestor.nativeThreadId} className="session-assets-materials-row">
              <code>{ancestor.nativeThreadId}</code>
              <Tag>{t('session_assets.materials.fork_prefix')}</Tag>
            </div>
          ))
        )}
      </Section>
      <Section title={t('session_assets.materials.attachments')}>
        {detail.attachments.length === 0 ? (
          <span className="session-assets-materials-empty">{t('session_assets.materials.no_attachments')}</span>
        ) : (
          detail.attachments.map((attachment) => (
            <div key={attachment.name} className="session-assets-materials-row">
              <code>{attachment.name}</code>
              <Tag>{attachment.disposition}</Tag>
            </div>
          ))
        )}
      </Section>
      {detail.missing.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={t('session_assets.materials.missing_title')}
          description={detail.missing.map((record) => (
            <div key={record.reason + record.detail}>{record.reason}: {record.detail}</div>
          ))}
        />
      ) : null}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="session-assets-materials-section">
    <h4>{title}</h4>
    {children}
  </section>
);

const formatSize = (size: number): string => {
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size > 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
};

