/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  recallTableDesignerColumnsClipboard,
  rememberTableDesignerColumnsClipboard,
  resetTableDesignerColumnsClipboardMemory,
} from './tableDesignerColumnClipboard';
import {
  resolveTableDesignerColumnClipboardShortcut,
  type TableDesignerClipboardKeyEvent,
} from './tableDesignerColumnClipboardShortcuts';

const keyEvent = (
  key: string,
  overrides: Partial<TableDesignerClipboardKeyEvent> = {},
): TableDesignerClipboardKeyEvent => ({
  key,
  metaKey: false,
  ctrlKey: true,
  altKey: false,
  shiftKey: false,
  target: null,
  ...overrides,
});

describe('tableDesignerColumnClipboardShortcuts', () => {
  afterEach(() => {
    resetTableDesignerColumnsClipboardMemory();
  });

  it('copies selected columns with Ctrl/Cmd+C even without a text selection', () => {
    expect(resolveTableDesignerColumnClipboardShortcut(keyEvent('c'), {
      selectedCount: 1,
      readOnly: false,
      shortcutEnabled: true,
      hasInAppColumns: false,
    })).toBe('copy');
    expect(resolveTableDesignerColumnClipboardShortcut(keyEvent('c', { ctrlKey: false, metaKey: true }), {
      selectedCount: 2,
      readOnly: true,
      shortcutEnabled: true,
      hasInAppColumns: false,
    })).toBe('copy');
  });

  it('does not steal copy when no field is selected or text is highlighted', () => {
    const input = document.createElement('input');
    input.value = 'vip_level';
    input.setSelectionRange(0, 3);
    expect(resolveTableDesignerColumnClipboardShortcut(keyEvent('c'), {
      selectedCount: 0,
      readOnly: false,
      shortcutEnabled: true,
      hasInAppColumns: false,
    })).toBeNull();
    expect(resolveTableDesignerColumnClipboardShortcut(keyEvent('c', { target: input }), {
      selectedCount: 1,
      readOnly: false,
      shortcutEnabled: true,
      hasInAppColumns: false,
    })).toBeNull();
  });

  it('pastes with Ctrl/Cmd+V after an in-app field copy', () => {
    rememberTableDesignerColumnsClipboard([{
      name: 'vip_level',
      type: 'smallint',
      nullable: 'NO',
      key: '',
      extra: '',
      comment: '',
    }]);
    expect(recallTableDesignerColumnsClipboard()?.[0]?.name).toBe('vip_level');
    expect(resolveTableDesignerColumnClipboardShortcut(keyEvent('v'), {
      selectedCount: 0,
      readOnly: false,
      shortcutEnabled: true,
      hasInAppColumns: true,
    })).toBe('paste');
    expect(resolveTableDesignerColumnClipboardShortcut(keyEvent('v'), {
      selectedCount: 0,
      readOnly: true,
      shortcutEnabled: true,
      hasInAppColumns: true,
    })).toBeNull();
  });

  it('ignores clipboard shortcuts outside the columns tab', () => {
    expect(resolveTableDesignerColumnClipboardShortcut(keyEvent('c'), {
      selectedCount: 1,
      readOnly: false,
      shortcutEnabled: false,
      hasInAppColumns: false,
    })).toBeNull();
  });
});
