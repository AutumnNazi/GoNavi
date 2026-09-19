// 查询编辑器运行时绑定参数的前端类型与纯函数模型。
// 解析权威在后端（AnalyzeQueryParameters）；前端只负责呈现与收集输入。

export type QueryParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'null'
  | 'list';

export interface QueryParamStatementInfo {
  index: number;
  text: string;
  parameters: string[];
}

export interface QueryParameterAnalysisInfo {
  supported: boolean;
  statements: QueryParamStatementInfo[];
  parameterNames: string[];
  messageKey?: string;
  detail?: string;
}

// 单个参数的当前输入：type 决定输入控件与后端转换，value 为原始标量或列表。
export interface QueryParamInput {
  type: QueryParamType;
  value: string | number | boolean | null | unknown[];
}

export type QueryParamValueMap = Record<string, QueryParamInput>;

export interface QueryParamBindingInput {
  name: string;
  type?: string;
  value?: unknown;
}

export interface SavedQueryParamInfo {
  name: string;
  type?: string;
  label?: string;
  default?: unknown;
}

export const QUERY_EDITOR_PARAMS_PANEL_KEY = '__gonavi_params_panel__';

// 收集尚未填值的参数名（NULL 类型视作已填；列表需至少一项）。
export function collectMissingParamNames(
  parameterNames: string[],
  values: QueryParamValueMap,
): string[] {
  const missing: string[] = [];
  for (const name of parameterNames) {
    const input = values[name];
    if (!input) {
      missing.push(name);
      continue;
    }
    if (input.type === 'null') {
      continue;
    }
    if (input.value === null || input.value === undefined || input.value === '') {
      missing.push(name);
      continue;
    }
    if (input.type === 'list' && (!Array.isArray(input.value) || input.value.length === 0)) {
      missing.push(name);
    }
  }
  return missing;
}

// 把当前输入收敛为按名提交的绑定列表，只包含分析结果中存在的参数。
export function bindingsFromValues(
  parameterNames: string[],
  values: QueryParamValueMap,
): QueryParamBindingInput[] {
  const bindings: QueryParamBindingInput[] = [];
  for (const name of parameterNames) {
    const input = values[name];
    if (!input) {
      continue;
    }
    bindings.push({
      name,
      type: input.type,
      value: input.type === 'null' ? null : input.value,
    });
  }
  return bindings;
}

// 用保存查询的参数声明预填输入（默认值视作已填值，可直接一键执行）。
export function initialValuesFromSavedParams(
  savedParams: SavedQueryParamInfo[] | undefined | null,
): QueryParamValueMap {
  const values: QueryParamValueMap = {};
  if (!savedParams || savedParams.length === 0) {
    return values;
  }
  for (const param of savedParams) {
    const name = String(param.name || '').trim();
    if (!name || param.default === undefined || param.default === null) {
      continue;
    }
    values[name] = {
      type: (param.type as QueryParamType) || 'string',
      value: param.default as QueryParamInput['value'],
    };
  }
  return values;
}

// 汇总参数在哪些语句组中出现，用于面板/弹窗的「亦用于 SQL n」提示。
export function paramStatementUsage(
  statements: QueryParamStatementInfo[],
): Record<string, number[]> {
  const usage: Record<string, number[]> = {};
  for (const statement of statements) {
    for (const name of statement.parameters || []) {
      if (!usage[name]) {
        usage[name] = [];
      }
      if (!usage[name].includes(statement.index)) {
        usage[name].push(statement.index);
      }
    }
  }
  return usage;
}
