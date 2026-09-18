import { describe, expect, it } from 'vitest';

import {
  countQueryEditorTabularResultSets,
  filterSqlServerResultMessages,
  finalizeQueryEditorSqlServerResultSets,
  isIgnorableSqlServerResultNotice,
  resolveQueryEditorExecutionSuccessToast,
} from './queryEditorSqlServerResultMessages';

describe('queryEditorSqlServerResultMessages', () => {
  it('treats SQL Server session and row-count notices as ignorable', () => {
    expect(isIgnorableSqlServerResultNotice("Changed database context to 'NSGJ_Golf75'.")).toBe(true);
    expect(isIgnorableSqlServerResultNotice('Changed language setting to us_english.')).toBe(true);
    expect(isIgnorableSqlServerResultNotice('已将数据库上下文更改为 \'master\'。')).toBe(true);
    expect(isIgnorableSqlServerResultNotice('(231 row(s) affected)')).toBe(true);
    expect(isIgnorableSqlServerResultNotice('4 rows affected')).toBe(true);
    expect(isIgnorableSqlServerResultNotice('231 行受影响')).toBe(true);
    expect(isIgnorableSqlServerResultNotice("insert into c_user(userid) values('168')")).toBe(false);
    expect(isIgnorableSqlServerResultNotice("Table 'users'. Scan count 1, logical reads 3.")).toBe(false);
  });

  it('drops ignorable notices without rewriting remaining PRINT lines', () => {
    expect(filterSqlServerResultMessages([
      "mssql: Changed database context to 'NSGJ_Golf75'.",
      "    select c.queryno,'' ,left(dbo.f_vendor_class(''' + b.groupid + ''',' + colname + '),",
      '',
      "        where funcno = @funcno and tabname = '$vendorclass'",
    ])).toEqual([
      "    select c.queryno,'' ,left(dbo.f_vendor_class(''' + b.groupid + ''',' + colname + '),",
      '',
      "        where funcno = @funcno and tabname = '$vendorclass'",
    ]);
  });

  it('drops message-only tabs that only carried ignorable SQL Server notices', () => {
    const resultSets = finalizeQueryEditorSqlServerResultSets('sqlserver', [
      { resultType: 'grid' as const, columns: ['id'], messages: ["Changed database context to 'master'."] },
      { resultType: 'message' as const, columns: [], messages: ['(4 row(s) affected)'] },
      { resultType: 'message' as const, columns: [], messages: ['PRINT generated sql'] },
    ]);
    expect(resultSets).toEqual([
      { resultType: 'grid', columns: ['id'], messages: [] },
      { resultType: 'message', columns: [], messages: ['PRINT generated sql'] },
    ]);
  });

  it('counts only tabular result sets in the execution toast', () => {
    const resultSets = [
      { columns: ['id'] },
      { resultType: 'message' as const, messages: ['PRINT generated sql'] },
    ];
    expect(countQueryEditorTabularResultSets(resultSets)).toBe(1);
    expect(resolveQueryEditorExecutionSuccessToast(2, resultSets)).toEqual({
      key: 'query_editor.message.execution_result_sets_success',
      params: { results: 1 },
    });
    expect(resolveQueryEditorExecutionSuccessToast(2, [
      { columns: ['name'] },
      { columns: ['owner'] },
    ])).toEqual({
      key: 'query_editor.message.execution_result_sets_success',
      params: { results: 2 },
    });
  });
});
