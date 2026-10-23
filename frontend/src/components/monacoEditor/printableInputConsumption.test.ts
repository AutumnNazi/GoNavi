import { describe, expect, it } from 'vitest';

import { isPrintableInputConsumedWithoutTextChange } from './printableInputConsumption';

describe('printableInputConsumption', () => {
  it('treats an unchanged text with a forward caret as consumed by the editor', () => {
    expect(isPrintableInputConsumedWithoutTextChange(
      { valueBefore: '()', offsetBefore: 1, text: ')' },
      '()',
      2,
    )).toBe(true);
  });

  it('does not treat an unchanged caret as consumed', () => {
    expect(isPrintableInputConsumedWithoutTextChange(
      { valueBefore: 'ab', offsetBefore: 2, text: 'c' },
      'ab',
      2,
    )).toBe(false);
  });

  it('does not treat a caret moved onto another character as consumed', () => {
    // 光标只是被移动到了别的字符上，输入本身仍然丢失，必须照常兜底。
    expect(isPrintableInputConsumedWithoutTextChange(
      { valueBefore: 'xy', offsetBefore: 1, text: 'a' },
      'xy',
      2,
    )).toBe(false);
  });

  it('does not treat a changed text as consumed', () => {
    expect(isPrintableInputConsumedWithoutTextChange(
      { valueBefore: '', offsetBefore: 0, text: '(' },
      '()',
      1,
    )).toBe(false);
  });

  it('does not treat an unknown offset as consumed', () => {
    expect(isPrintableInputConsumedWithoutTextChange(
      { valueBefore: '()', offsetBefore: 1, text: ')' },
      '()',
      undefined,
    )).toBe(false);
    expect(isPrintableInputConsumedWithoutTextChange(
      { valueBefore: '()', offsetBefore: 1, text: ')' },
      '()',
      Number.NaN,
    )).toBe(false);
  });
});
