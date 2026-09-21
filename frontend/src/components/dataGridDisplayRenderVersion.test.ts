import { describe, expect, it } from 'vitest';

import {
  attachDataGridDisplayRenderVersion,
  hasDataGridDisplayRenderVersionChanged,
} from './dataGridDisplayRenderVersion';

describe('dataGridDisplayRenderVersion', () => {
  it('reuses initial result rows and derives them only when the display version changes', () => {
    const rows = [{ id: 1 }, { id: 2 }];

    const initial = attachDataGridDisplayRenderVersion(rows, 'light|comfortable|1');
    const repeated = attachDataGridDisplayRenderVersion(rows, 'light|comfortable|1');
    const themed = attachDataGridDisplayRenderVersion(rows, 'dark|comfortable|1');
    const themedAgain = attachDataGridDisplayRenderVersion(rows, 'dark|comfortable|1');

    expect(initial).toBe(rows);
    expect(repeated).toBe(rows);
    expect(themed).not.toBe(rows);
    expect(themed[0]).not.toBe(rows[0]);
    expect(themedAgain[0]).toBe(themed[0]);
    expect(hasDataGridDisplayRenderVersionChanged(themed[0], initial[0])).toBe(true);
  });

  it('returns the original array until a display setting actually changes', () => {
    const rows = Array.from({ length: 5_000 }, (_, id) => ({ id }));

    expect(attachDataGridDisplayRenderVersion(rows, 'light')).toBe(rows);
    expect(attachDataGridDisplayRenderVersion(rows, 'light')).toBe(rows);
    expect(attachDataGridDisplayRenderVersion(rows, 'dark')).not.toBe(rows);
  });
});
