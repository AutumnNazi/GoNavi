export interface SqlEditorTypographySettings {
  sqlEditorFontSize: number | null;
  sqlEditorFontSizeFollowGlobal: boolean;
}

export const MIN_SQL_EDITOR_FONT_SIZE = 10;
export const MAX_SQL_EDITOR_FONT_SIZE = 20;
export const DEFAULT_SQL_EDITOR_FONT_SCALE = 0.92;

export const DEFAULT_SQL_EDITOR_TYPOGRAPHY_SETTINGS: SqlEditorTypographySettings = {
  sqlEditorFontSize: null,
  sqlEditorFontSizeFollowGlobal: true,
};

export const sanitizeSqlEditorFontSize = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(
    MAX_SQL_EDITOR_FONT_SIZE,
    Math.max(MIN_SQL_EDITOR_FONT_SIZE, Math.round(numeric)),
  );
};

export const resolveSqlEditorFontSize = ({
  globalFontSize,
  sqlEditorFontSize,
  sqlEditorFontSizeFollowGlobal,
}: {
  globalFontSize: number;
  sqlEditorFontSize: unknown;
  sqlEditorFontSizeFollowGlobal: unknown;
}): number => {
  const normalizedGlobalFontSize = Number.isFinite(Number(globalFontSize))
    ? Number(globalFontSize)
    : 14;
  const globalDerivedFontSize = sanitizeSqlEditorFontSize(
    Math.round(normalizedGlobalFontSize * DEFAULT_SQL_EDITOR_FONT_SCALE),
  ) ?? 13;

  if (sqlEditorFontSizeFollowGlobal !== false) {
    return globalDerivedFontSize;
  }

  return sanitizeSqlEditorFontSize(sqlEditorFontSize) ?? globalDerivedFontSize;
};

export const sanitizeSqlEditorTypographySettings = (
  value: Partial<SqlEditorTypographySettings> | undefined,
): SqlEditorTypographySettings => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SQL_EDITOR_TYPOGRAPHY_SETTINGS };
  }

  const sqlEditorFontSize = sanitizeSqlEditorFontSize(value.sqlEditorFontSize);
  return {
    sqlEditorFontSize,
    sqlEditorFontSizeFollowGlobal: typeof value.sqlEditorFontSizeFollowGlobal === 'boolean'
      ? value.sqlEditorFontSizeFollowGlobal
      : sqlEditorFontSize === null,
  };
};

export const migrateLegacySqlEditorTypographySettings = ({
  dataTableFontSize,
  dataTableFontSizeFollowGlobal,
}: {
  dataTableFontSize: unknown;
  dataTableFontSizeFollowGlobal: unknown;
}): SqlEditorTypographySettings => {
  if (dataTableFontSizeFollowGlobal !== false) {
    return { ...DEFAULT_SQL_EDITOR_TYPOGRAPHY_SETTINGS };
  }

  const sanitizedDataTableFontSize = sanitizeSqlEditorFontSize(dataTableFontSize);
  return {
    sqlEditorFontSize: sanitizedDataTableFontSize === null
      ? null
      : sanitizeSqlEditorFontSize(
          Math.round(sanitizedDataTableFontSize * DEFAULT_SQL_EDITOR_FONT_SCALE),
        ),
    sqlEditorFontSizeFollowGlobal: false,
  };
};
