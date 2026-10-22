type FontFamilyDocument = Pick<Document, 'body' | 'documentElement'>;

/** Keep portals and body-scoped theme tokens on the same font settings as the root. */
export const applyDocumentFontFamilies = (
  uiFontFamily: string,
  monoFontFamily: string,
  documentRef: FontFamilyDocument | null = typeof document === 'undefined' ? null : document,
): void => {
  if (!documentRef) return;
  for (const element of [documentRef.documentElement, documentRef.body]) {
    element?.style.setProperty('--gn-font-sans', uiFontFamily);
    element?.style.setProperty('--gn-font-mono', monoFontFamily);
  }
};
