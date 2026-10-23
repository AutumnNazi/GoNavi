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
const MODEL = 'body[data-ui-version="v2"] .gn-v2-ai-model-bar .gn-v2-ai-model-select';
const MODEL_LABEL = 'body[data-ui-version="v2"] .gn-v2-ai-provider-model-label';
const THINKING = 'body[data-ui-version="v2"] .gn-v2-ai-thinking-select';

describe('AI 输入区工具条单行布局', () => {
    it('连接与思考按权重分行宽，模型按钮按文字收紧', () => {
        const css = readV2ThemeCss();

        // 权重即百分比：flex-basis 归零后按权重分割「行宽扣除用量环与间距」的剩余空间。
        expect(readCssRules(css, CHIP).join('\n')).toContain('flex: 40 1 0;');
        expect(readCssRules(css, THINKING).join('\n')).toMatch(/flex:\s*25 1 0\s*!important;/);

        // 模型入口改成按钮后不再参与百分比分栏：按模型名收紧，空间不足时仍可收缩。
        const modelRules = readCssRules(css, MODEL).join('\n');
        expect(modelRules).toContain('width: max-content !important;');
        expect(modelRules).toContain('flex: 0 1 auto !important;');
        expect(modelRules).toContain('min-width: 0 !important;');
    });

    it('工具条不换行，窄窗口靠收缩而不是折成两行', () => {
        const css = readV2ThemeCss();
        const barRules = readCssRules(css, BAR).join('\n');

        expect(barRules).toContain('flex-wrap: nowrap;');
        expect(barRules).not.toContain('flex-wrap: wrap;');
    });

    it('收缩时由省略号收尾', () => {
        const css = readV2ThemeCss();

        [CHIP, THINKING].forEach((selector) => {
            const rules = readCssRules(css, selector).join('\n');
            // 写死像素的宽度上限会让控件永远停在固定宽度，面板拖宽也不跟随。
            expect(rules, selector).not.toMatch(/(?:^|[^-])(?:width|min-width|max-width):\s*[^;]*\d+px/);
            expect(rules, selector).toContain('min-width: 0');
        });

        // 模型按钮靠标签省略号收尾，而不是用像素宽度硬截断。
        const modelLabelRules = readCssRules(css, MODEL_LABEL).join('\n');
        expect(modelLabelRules).toContain('min-width: 0;');
        expect(modelLabelRules).toContain('overflow: hidden;');
        expect(modelLabelRules).toContain('text-overflow: ellipsis;');
        expect(modelLabelRules).toContain('white-space: nowrap;');

        const chipTextRules = readCssRules(css, `${CHIP}-text`).join('\n');
        expect(chipTextRules).toContain('text-overflow: ellipsis;');
        expect(chipTextRules).toContain('white-space: nowrap;');
    });
});
