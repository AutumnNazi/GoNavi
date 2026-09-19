import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { OverlayWorkbenchTheme } from '../../../utils/overlayWorkbenchTheme';
import { normalizeAiMarkdown } from '../../../utils/aiMarkdown';
import { AIMessageCodeBlock } from './AIMessageCodeBlock';

const remarkPlugins = [remarkGfm];

interface AIMessageMarkdownProps {
  content: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  activeConnectionConfig?: any;
  activeConnectionId?: string;
  activeDbName?: string;
  /** 会话中该消息对应的“原 SQL”候选，供“插入 SQL”替换偏好使用。 */
  originalSqlCandidates?: string[];
}

export const AIMessageMarkdown: React.FC<AIMessageMarkdownProps> = React.memo(({
  content,
  darkMode,
  overlayTheme,
  activeConnectionConfig,
  activeConnectionId,
  activeDbName,
  originalSqlCandidates,
}) => {
  const normalizedContent = React.useMemo(() => normalizeAiMarkdown(content), [content]);
  const components = React.useMemo(() => ({
    code({ inline, className, children }: any) {
      return (
        <AIMessageCodeBlock
          inline={inline}
          className={className}
          darkMode={darkMode}
          overlayTheme={overlayTheme}
          activeConnectionConfig={activeConnectionConfig}
          activeConnectionId={activeConnectionId}
          activeDbName={activeDbName}
          originalSqlCandidates={originalSqlCandidates}
        >
          {children}
        </AIMessageCodeBlock>
      );
    },
  }), [darkMode, overlayTheme, activeConnectionConfig, activeConnectionId, activeDbName, originalSqlCandidates]);

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {normalizedContent}
    </ReactMarkdown>
  );
});
