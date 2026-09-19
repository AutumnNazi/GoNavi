import { resolveSqlDialect } from '../../utils/sqlDialect';
import { diagnoseExecutionErrorWithAI } from './queryEditorAiPromptInject';

interface QueryEditorErrorDiagnoseOptions {
    /** 惰性求值：事件触发时才调用，允许引用组件中后置声明的值。 */
    getEditorSql: () => string;
    /** 见 useQueryEditorSqlErrorLocator：解析出错的那一条语句，失败返回空串。 */
    resolveExecutionErrorStatement: (error: string, editorSql: string, dbType?: string) => string;
    getDialect: () => string;
}

/**
 * 一键 AI 诊断（结果区按钮与快捷键共用）：把「出错的那一条语句」注入 AI 面板，
 * 而不是整篇查询——后续“替换原 SQL”才能只替换该语句，不影响编辑器中其他语句。
 * 解析不出出错语句时回退为整篇查询（历史行为）。
 */
export const useQueryEditorErrorDiagnose = ({
    getEditorSql,
    resolveExecutionErrorStatement,
    getDialect,
}: QueryEditorErrorDiagnoseOptions) => (error: string) => {
    const editorSql = getEditorSql();
    const failingStatement = resolveExecutionErrorStatement(
        error,
        editorSql,
        getDialect(),
    );
    diagnoseExecutionErrorWithAI(failingStatement || editorSql, error);
};
