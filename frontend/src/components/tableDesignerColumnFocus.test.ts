import { describe, expect, it } from 'vitest';

import { isTableDesignerSortCellKey } from './tableDesignerColumnFocus';

describe('tableDesignerColumnFocus', () => {
  it('recognizes the antd-prefixed sort cell key', () => {
    expect(isTableDesignerSortCellKey('sort')).toBe(true);
    expect(isTableDesignerSortCellKey('.$sort')).toBe(true);
    expect(isTableDesignerSortCellKey('.$name')).toBe(false);
  });
});
