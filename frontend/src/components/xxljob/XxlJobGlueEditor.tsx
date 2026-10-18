import React from 'react';
import MonacoEditor from '../MonacoEditor';

type Props = {
  language: string;
  value: string;
  onChange: (value: string) => void;
  height?: number;
};

// GLUE 源码编辑器：复用仓库统一的 Monaco 包装（主题、剪贴板、IME 已处理），
// 按 glueType 切换语言。
export const XxlJobGlueEditor: React.FC<Props> = ({ language, value, onChange, height = 320 }) => (
  <MonacoEditor
    height={height}
    language={language}
    value={value}
    onChange={(next) => onChange(next ?? '')}
    options={{
      minimap: { enabled: false },
      fontSize: 12,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 4,
      wordWrap: 'on',
    }}
  />
);

export default XxlJobGlueEditor;
