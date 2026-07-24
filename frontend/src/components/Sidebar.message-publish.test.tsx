import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sidebarSource = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
const contextMenuSource = readFileSync(new URL('./V2TableContextMenu.tsx', import.meta.url), 'utf8');
const legacyMenuSource = readFileSync(new URL('./sidebar/sidebarLegacyNodeMenu.tsx', import.meta.url), 'utf8');
const v2ActionSource = readFileSync(new URL('./sidebar/useSidebarV2ActionHandlers.tsx', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('./MessagePublishModal.tsx', import.meta.url), 'utf8');

describe('Sidebar Kafka publish entry', () => {
  it('adds a Kafka topic publish action in both legacy and v2 table menus', () => {
    expect(legacyMenuSource).toContain("key: 'publish-message'");
    expect(legacyMenuSource).toContain("label: t('message_publish_modal.title')");
    expect(legacyMenuSource).toContain('openMessagePublishModal(node)');
    expect(contextMenuSource).toContain("| 'publish-message'");
    expect(contextMenuSource).toContain("title: t('message_publish_modal.title')");
    expect(v2ActionSource).toContain("case 'publish-message'");
    expect(v2ActionSource).toContain('openMessagePublishModal(node)');
    expect(contextMenuSource).not.toContain("title: '测试发送消息'");
  });

  it('renders the dedicated message publish modal and executes an audited user action through the encoder', () => {
    expect(sidebarSource).toContain('<MessagePublishModal');
    expect(modalSource).toContain('buildMessagePublishCommand');
    expect(modalSource).toContain('DBQueryAudited(');
    expect(modalSource).toContain("'message_publish'");
    expect(modalSource).toContain("t('message_publish_modal.field.body.label')");
  });
});
