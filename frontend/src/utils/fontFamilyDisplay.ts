import { sanitizeFontFamilyInput, type FontFamilyOption } from './fontFamilies';

// 仅用于展示旧配置；保存与渲染仍使用完整原值，不重写回退链。
export const getPrimaryFontFamily = (value: string): string => {
  let quote = '';
  let escaped = false;
  let family = '';
  for (const character of value.trim()) {
    if (escaped) {
      family += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = '';
      else family += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ',') {
      break;
    } else {
      family += character;
    }
  }
  return family.trim();
};

export const resolveFontSelection = (
  value: string | null | undefined,
  options: FontFamilyOption[],
  defaultValue: string,
  defaultLabel: string,
): { value: string; label: string } => {
  const normalized = sanitizeFontFamilyInput(value);
  if (!normalized || normalized === defaultValue) {
    return { value: defaultValue, label: defaultLabel };
  }
  const matched = options.find(option => option.value === normalized);
  return { value: normalized, label: matched?.label || getPrimaryFontFamily(normalized) || defaultLabel };
};
