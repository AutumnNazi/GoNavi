import { describe, expect, it, vi } from 'vitest';

import { installMonacoWorkerEnvironment } from './MonacoEditor';

describe('MonacoEditor worker environment', () => {
  it('routes Monaco languages to bundled workers', () => {
    const createWorker = (name: string) => vi.fn(() => ({ name } as unknown as Worker));
    const workers = {
      editor: createWorker('editor'),
      json: createWorker('json'),
      css: createWorker('css'),
      html: createWorker('html'),
      typescript: createWorker('typescript'),
    };
    const scope: Record<string, any> = {};

    installMonacoWorkerEnvironment(scope, workers);

    expect(scope.MonacoEnvironment.getWorker('', 'json')).toEqual({ name: 'json' });
    expect(scope.MonacoEnvironment.getWorker('', 'css')).toEqual({ name: 'css' });
    expect(scope.MonacoEnvironment.getWorker('', 'scss')).toEqual({ name: 'css' });
    expect(scope.MonacoEnvironment.getWorker('', 'html')).toEqual({ name: 'html' });
    expect(scope.MonacoEnvironment.getWorker('', 'handlebars')).toEqual({ name: 'html' });
    expect(scope.MonacoEnvironment.getWorker('', 'typescript')).toEqual({ name: 'typescript' });
    expect(scope.MonacoEnvironment.getWorker('', 'javascript')).toEqual({ name: 'typescript' });
    expect(scope.MonacoEnvironment.getWorker('', 'sql')).toEqual({ name: 'editor' });
  });
});
