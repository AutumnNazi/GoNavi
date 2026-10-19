import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 会话详情的 Markdown 渲染：轻量封装 react-markdown + GFM。
 * 独立于 AI 面板的渲染器（不依赖连接上下文与 SQL 注入偏好），
 * 供会话时间线的用户气泡与助手正文使用。
 */
const remarkPlugins = [remarkGfm];

export const SessionAgentMarkdown: React.FC<{ content: string }> = ({ content }) => (
  <div className="session-agent-markdown" data-session-agent-markdown="true">
    <ReactMarkdown remarkPlugins={remarkPlugins}>{content ?? ''}</ReactMarkdown>
  </div>
);
