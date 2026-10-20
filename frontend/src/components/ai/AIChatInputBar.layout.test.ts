import { describe, expect, it } from 'vitest';
import { readV2ThemeCss } from '../../test/readV2ThemeCss';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 主题分片里同一选择器可能出现多次，逐块收集后再断言，避免只看第一块漏掉后面的覆盖值。
// 只收「选择器后直接接花括号」的规则；后代/组合选择器（.chip > .anticon）不算本选择器的声明。
const readCssRules = (css: string, selector: string): string[] => {
    const pattern = new RegExp(escapeRegExp(selector) + '(?![\\w-])\\s*(?:\\{[^}]*\\}|,\\s*[^{}]+\\{)', 'g');
    const rules: string[] = [];
    let match = pattern.exec(css);
    while (match) {
        const block = match[0];
        rules.push(block.slice(block.indexOf('{') + 1, block.lastIndexOf('}')));
        match = pattern.exec(css);
    }
    return rules;
};

const BAR = 'body[data-ui-version="v2"] .gn-v2-ai-model-bar';
const CHIP = 'body[data-ui-version="v2"] .gn-v2-ai-context-chip';
const MODEL = 'body[data-ui-version="v2"] .gn-v2-ai-model-select';
const THINKING = 'body[data-ui-version="v2"] .gn-v2-ai-thinking-select';

describe('AI 输入区工具条单行布局', () => {
    it('连接 / 模型 / 思考三个控件按 40:35:25 分行宽', () => {
        const css = readV2ThemeCss();

        // 权重即百分比：flex-basis 归零后按权重分割「行宽扣除用量环与间距」的剩余空间。
        expect(readCssRules(css, CHIP).join('\n')).toContain('flex: 40 1 0;');
        expect(readCssRules(css, MODEL).join('\n')).toMatch(/flex:\s*35 1 0\s*!important;/);
        expect(readCssRules(css, THINKING).join('\n')).toMatch(/flex:\s*25 1 0\s*!important;/);
    });

    it('工具条不换行，窄窗口靠收缩而不是折成两行', () => {
        const css = readV2ThemeCss();
        const barRules = readCssRules(css, BAR).join('\n');

        expect(barRules).toContain('flex-wrap: nowrap;');
        expect(barRules).not.toContain('flex-wrap: wrap;');
    });

    it('三个控件都不再写死像素宽度，收缩时由省略号收尾', () => {
        const css = readV2ThemeCss();

        [CHIP, MODEL, THINKING].forEach((selector) => {
            const rules = readCssRules(css, selector).join('\n');
            // 写死像素的宽度上限会让控件永远停在固定宽度，面板拖宽也不跟随。
            expect(rules, selector).not.toMatch(/(?:^|[^-])(?:width|min-width|max-width):\s*[^;]*\d+px/);
            expect(rules, selector).toContain('min-width: 0');
        });

        const chipTextRules = readCssRules(css, `${CHIP}-text`).join('\n');
        expect(chipTextRules).toContain('text-overflow: ellipsis;');
        expect(chipTextRules).toContain('white-space: nowrap;');
    });
});
