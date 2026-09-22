/**
 * 「生产连接保护」面板的「仅只读」总开关逻辑（#1325）。
 *
 * 面板有四个分项（限制数据编辑 / 结构编辑 / 脚本执行 / 数据导入），用户最
 * 常见的诉求是一次开启全部。总开关状态由分项**派生**——任何适用分项未被
 * 勾选时总开关即为关闭，避免出现"总开关亮着但仍有分项没勾"的歧义状态；
 * Nacos 连接没有脚本执行分项，总开关只覆盖实际存在的分项。
 */

export interface ReadOnlyProtectionState {
  restrictDataEdit: boolean;
  restrictStructureEdit: boolean;
  restrictScriptExecution: boolean;
  restrictDataImport: boolean;
}

export type ReadOnlyProtectionField = keyof ReadOnlyProtectionState;

/** 面板实际展示的分项（按展示顺序）。supportsScriptExecution=false 时（Nacos）不含脚本执行。 */
export const readOnlyProtectionFields = (
  supportsScriptExecution: boolean,
): ReadOnlyProtectionField[] =>
  supportsScriptExecution
    ? [
        "restrictDataEdit",
        "restrictStructureEdit",
        "restrictScriptExecution",
        "restrictDataImport",
      ]
    : ["restrictDataEdit", "restrictStructureEdit", "restrictDataImport"];

/** 总开关状态：全部适用分项均已勾选才为开。 */
export const allReadOnlyProtectionChecked = (
  state: ReadOnlyProtectionState,
  supportsScriptExecution: boolean,
): boolean =>
  readOnlyProtectionFields(supportsScriptExecution).every(
    (field) => state[field],
  );

/**
 * 点击总开关：把所有适用分项切到同一值。
 * 全亮时点击 → 全部关闭；否则 → 全部开启。
 */
export const toggleAllReadOnlyProtection = (
  state: ReadOnlyProtectionState,
  supportsScriptExecution: boolean,
): ReadOnlyProtectionState => {
  const next = !allReadOnlyProtectionChecked(state, supportsScriptExecution);
  const result: ReadOnlyProtectionState = { ...state };
  for (const field of readOnlyProtectionFields(supportsScriptExecution)) {
    result[field] = next;
  }
  return result;
};
