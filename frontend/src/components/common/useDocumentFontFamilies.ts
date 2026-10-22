import { useLayoutEffect } from 'react';
import { useStore } from '../../store';
import { applyDocumentFontFamilies } from '../../utils/documentTypography';
import { resolveMonoFontFamily, resolveUIFontFamily } from '../../utils/fontFamilies';

/** Subscribe to host-synced preferences for standalone workbench windows. */
export const useDocumentFontFamilies = () => {
  const customUIFontFamily = useStore(state => state.appearance.customUIFontFamily);
  const customMonoFontFamily = useStore(state => state.appearance.customMonoFontFamily);
  const fontFamily = resolveUIFontFamily(customUIFontFamily);
  const fontFamilyCode = resolveMonoFontFamily(customMonoFontFamily);

  useLayoutEffect(() => {
    applyDocumentFontFamilies(fontFamily, fontFamilyCode);
  }, [fontFamily, fontFamilyCode]);

  return { fontFamily, fontFamilyCode };
};
