// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyDocumentFontFamilies } from './documentTypography';
import { DEFAULT_MONO_FONT_FAMILY, DEFAULT_UI_FONT_FAMILY } from './fontFamilies';

describe('applyDocumentFontFamilies', () => {
  it('sets both tokens on the root and body without replacing unrelated styles', () => {
    const documentRef = document.implementation.createHTMLDocument();
    documentRef.body.style.color = 'red';
    documentRef.documentElement.style.setProperty('--gn-ui-scale', '1.25');

    applyDocumentFontFamilies('Custom UI', 'Custom Mono', documentRef);

    for (const element of [documentRef.documentElement, documentRef.body]) {
      expect(element.style.getPropertyValue('--gn-font-sans')).toBe('Custom UI');
      expect(element.style.getPropertyValue('--gn-font-mono')).toBe('Custom Mono');
    }
    expect(documentRef.body.style.color).toBe('red');
    expect(documentRef.documentElement.style.getPropertyValue('--gn-ui-scale')).toBe('1.25');
  });

  it('replaces previous font tokens when restoring defaults', () => {
    const documentRef = document.implementation.createHTMLDocument();
    applyDocumentFontFamilies('Custom UI', 'Custom Mono', documentRef);
    applyDocumentFontFamilies(DEFAULT_UI_FONT_FAMILY, DEFAULT_MONO_FONT_FAMILY, documentRef);

    for (const element of [documentRef.documentElement, documentRef.body]) {
      expect(element.style.getPropertyValue('--gn-font-sans')).toBe(DEFAULT_UI_FONT_FAMILY);
      expect(element.style.getPropertyValue('--gn-font-mono')).toBe(DEFAULT_MONO_FONT_FAMILY);
    }
  });

  it('does nothing when a document is unavailable', () => {
    expect(() => applyDocumentFontFamilies('Custom UI', 'Custom Mono', null)).not.toThrow();
  });
});
