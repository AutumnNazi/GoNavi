import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./v2-theme.css', import.meta.url), 'utf8');

const readRuleBlock = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match?.[1]) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
};

const readHexProperty = (block: string, property: string): string => {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`${escaped}\\s*:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match?.[1]) throw new Error(`Missing hexadecimal custom property: ${property}`);
  return match[1];
};

const relativeLuminance = (hex: string): number => {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (foreground: string, background: string): number => {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
};

describe('v2 theme connection identity contrast', () => {
  it('uses dedicated connected-state tokens and distinct Host/DB tab colors', () => {
    const light = readRuleBlock('body[data-ui-version="v2"][data-theme="light"]');
    const dark = readRuleBlock('body[data-ui-version="v2"][data-theme="dark"]');
    const host = readRuleBlock('body[data-ui-version="v2"] .gn-v2-tab-label-part-host');
    const database = readRuleBlock('body[data-ui-version="v2"] .gn-v2-tab-label-part-database');
    const treeDot = readRuleBlock('body[data-ui-version="v2"] .gn-v2-tree-status::before');

    expect(host).toContain('color: var(--gn-info);');
    expect(database).toContain('color: var(--gn-accent);');
    expect(treeDot).toContain('width: 9px;');
    expect(treeDot).toContain('height: 9px;');
    expect(source).not.toContain('.gn-v2-live-dot');
    expect(source).toContain('background: var(--gn-status-connected);');

    for (const [mode, block] of [['light', light], ['dark', dark]] as const) {
      const panel2 = readHexProperty(block, '--gn-bg-panel-2');
      for (const property of ['--gn-info', '--gn-accent', '--gn-status-connected']) {
        expect(
          contrastRatio(readHexProperty(block, property), panel2),
          `${mode} ${property} must contrast with --gn-bg-panel-2`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
