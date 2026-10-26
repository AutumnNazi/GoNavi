import { useOptionalI18n } from '../../../i18n/provider';
import { t as catalogTranslate } from '../../../i18n/catalog';
export function useSkillCopy() {
  return useOptionalI18n()?.t ?? ((key: string, values?: Record<string, string | number>) => catalogTranslate('en-US', key, values));
}
