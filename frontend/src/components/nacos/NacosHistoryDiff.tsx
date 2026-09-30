import React, { useEffect, useState } from 'react';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import { ensureMonacoConfigured } from '../MonacoEditor';
import { registerGonaviMonacoThemes } from '../monacoThemes';
import { useStore } from '../../store';

const NacosHistoryDiff: React.FC<{
  original: string; modified: string; language: string; onMount?: DiffOnMount;
}> = ({ original, modified, language, onMount }) => {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const theme = useStore(state => state.theme);
  useEffect(() => {
    let cancelled = false;
    void ensureMonacoConfigured().then(() => { if (!cancelled) setReady(true); })
      .catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, []);
  if (error) return <div role="alert">{error}</div>;
  if (!ready) return null;
  return <DiffEditor height={360} original={original} modified={modified} language={language}
    theme={theme === 'dark' ? 'transparent-dark' : 'transparent-light'}
    beforeMount={registerGonaviMonacoThemes} onMount={onMount}
    options={{ readOnly: true, originalEditable: false, renderSideBySide: true,
      minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false,
      wordWrap: 'on', renderOverviewRuler: false, enableSplitViewResizing: true }} />;
};
export default NacosHistoryDiff;
