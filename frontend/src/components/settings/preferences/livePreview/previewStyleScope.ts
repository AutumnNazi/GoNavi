// Reuse the application's styles inside an isolated preview instead of maintaining a second theme.
export function scopePreviewSelector(selector: string): string {
  return selector.replace(/(^|[\s,>+~])body(?=[^\w-]|$)/g, '$1[data-preview-body]')
    .replace(/(^|[\s,>+~])html(?=[^\w-]|$)/g, '$1[data-preview-root]')
    .replace(/:root\b/g, '[data-preview-root]');
}
function serializeRule(rule: CSSRule): string {
  if ('selectorText' in rule) {
    const styleRule = rule as CSSStyleRule;
    const nested = 'cssRules' in styleRule ? Array.from(styleRule.cssRules).map(serializeRule).join('\n') : '';
    return `${scopePreviewSelector(styleRule.selectorText)} {${styleRule.style.cssText}${nested}}`;
  }
  if ('cssRules' in rule) {
    const group = rule as CSSGroupingRule;
    return `${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{${Array.from(group.cssRules).map(serializeRule).join('\n')}}`;
  }
  return rule.cssText;
}
export function collectPreviewStyles(doc: Document): string {
  return Array.from(doc.styleSheets).filter(sheet => !sheet.disabled).flatMap(sheet => {
    try {
      const css = Array.from(sheet.cssRules).map(serializeRule).join('\n');
      return sheet.media?.mediaText ? [`@media ${sheet.media.mediaText} {${css}}`] : [css];
    } catch { return []; }
  }).join('\n');
}
