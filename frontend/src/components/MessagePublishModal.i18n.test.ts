import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const modalSource = readFileSync(new URL('./MessagePublishModal.tsx', import.meta.url), 'utf8');

describe('MessagePublishModal i18n shell guards', () => {
  it('localizes the modal shell and send failure wrappers while preserving raw details', () => {
    [
      'message_publish_modal.title',
      'message_publish_modal.title_with_connection',
      'message_publish_modal.action.send',
      'message_publish_modal.error.build_command_failed',
      'message_publish_modal.error.send_failed_detail',
      'message_publish_modal.error.unknown_error',
    ].forEach((key) => {
      expect(modalSource).toContain(`t('${key}'`);
    });

    expect(modalSource).toContain('connectionName: connection.name');
    expect(modalSource).toContain('detail: res?.message');
    expect(modalSource).toContain('detail: error?.message || String(error)');
    expect(modalSource).toContain('destroyOnHidden');
    // Closed modals unmount Form; never call form APIs while open === false.
    expect(modalSource).not.toContain('form.resetFields()');
    expect(modalSource).not.toContain('测试发送消息');
    expect(modalSource).not.toContain('okText="发送"');
    expect(modalSource).not.toContain('发送失败:');
    expect(modalSource).not.toContain('未知错误');
    expect(modalSource).not.toContain('构造发送命令失败');
  });

  it('localizes the fixed form chrome without translating raw protocol terms', () => {
    [
      'message_publish_modal.field.exchange.label',
      'message_publish_modal.field.exchange.extra',
      'message_publish_modal.field.exchange.placeholder',
      'message_publish_modal.field.routing_key.label',
      'message_publish_modal.field.routing_key.extra',
      'message_publish_modal.field.routing_key.placeholder',
      'message_publish_modal.field.qos.extra',
      'message_publish_modal.field.retain.label',
      'message_publish_modal.field.tag.label',
      'message_publish_modal.field.tag.extra',
      'message_publish_modal.field.delay_level.label',
      'message_publish_modal.field.delay_level.extra',
      'message_publish_modal.field.body_mode.label',
      'message_publish_modal.field.body.label',
      'message_publish_modal.field.body.required',
      'message_publish_modal.field.body.extra',
      'message_publish_modal.field.body.placeholder',
      'message_publish_modal.field.headers.label',
      'message_publish_modal.field.headers.extra',
      'message_publish_modal.field.properties.label',
      'message_publish_modal.field.properties.extra',
      'message_publish_modal.option.no_delay',
      'message_publish_modal.option.text',
      'message_publish_modal.footer.success_prefix',
      'message_publish_modal.footer.success_suffix',
    ].forEach((key) => {
      expect(modalSource).toContain(`t('${key}'`);
    });

    [
      '不延时',
      'Exchange（可选）',
      '留空使用默认交换机',
      'Routing Key（可选）',
      '留空时默认使用当前 Queue 名',
      '0 为至多一次',
      'Retain 消息',
      'Tag（可选）',
      'Delay Level（可选）',
      'RocketMQ 使用固定延时级别',
      '文本',
      '消息体类型',
      '消息体',
      '请输入消息体',
      'JSON 模式下需输入合法 JSON',
      'Headers（可选）',
      '需为 JSON 对象',
      'Properties（可选）',
      '发送成功后会返回',
      '用于确认本次测试消息是否已提交',
    ].forEach((legacyText) => {
      expect(modalSource).not.toContain(legacyText);
    });

    expect(modalSource).toContain('affectedRows');
  });

  it('keeps the modal shell keys in every locale catalog with matching placeholders', () => {
    (['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const).forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;

      [
        'message_publish_modal.title',
        'message_publish_modal.action.send',
        'message_publish_modal.error.build_command_failed',
        'message_publish_modal.error.unknown_error',
      ].forEach((key) => {
        expect(catalog[key]).toEqual(expect.any(String));
        expect(catalog[key].length).toBeGreaterThan(0);
      });

      expect(catalog['message_publish_modal.title_with_connection']).toContain('{{connectionName}}');
      expect(catalog['message_publish_modal.error.send_failed_detail']).toContain('{{detail}}');
    });
  });

  it('keeps the fixed form chrome keys in every locale catalog', () => {
    (['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const).forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;

      [
        'message_publish_modal.field.exchange.label',
        'message_publish_modal.field.exchange.extra',
        'message_publish_modal.field.exchange.placeholder',
        'message_publish_modal.field.routing_key.label',
        'message_publish_modal.field.routing_key.extra',
        'message_publish_modal.field.routing_key.placeholder',
        'message_publish_modal.field.qos.extra',
        'message_publish_modal.field.retain.label',
        'message_publish_modal.field.tag.label',
        'message_publish_modal.field.tag.extra',
        'message_publish_modal.field.delay_level.label',
        'message_publish_modal.field.delay_level.extra',
        'message_publish_modal.field.body_mode.label',
        'message_publish_modal.field.body.label',
        'message_publish_modal.field.body.required',
        'message_publish_modal.field.body.extra',
        'message_publish_modal.field.body.placeholder',
        'message_publish_modal.field.headers.label',
        'message_publish_modal.field.headers.extra',
        'message_publish_modal.field.properties.label',
        'message_publish_modal.field.properties.extra',
        'message_publish_modal.option.no_delay',
        'message_publish_modal.option.text',
        'message_publish_modal.footer.success_prefix',
        'message_publish_modal.footer.success_suffix',
      ].forEach((key) => {
        expect(catalog[key]).toEqual(expect.any(String));
        expect(catalog[key].length).toBeGreaterThan(0);
      });

      [
        ['message_publish_modal.field.exchange.label', 'Exchange'],
        ['message_publish_modal.field.routing_key.label', 'Routing Key'],
        ['message_publish_modal.field.qos.extra', 'at most once'],
        ['message_publish_modal.field.qos.extra', 'at least once'],
        ['message_publish_modal.field.qos.extra', 'exactly once'],
        ['message_publish_modal.field.retain.label', 'Retain'],
        ['message_publish_modal.field.tag.label', 'Tag'],
        ['message_publish_modal.field.delay_level.label', 'Delay Level'],
        ['message_publish_modal.field.delay_level.extra', 'RocketMQ'],
        ['message_publish_modal.field.body.extra', 'JSON'],
        ['message_publish_modal.field.headers.label', 'Headers'],
        ['message_publish_modal.field.properties.label', 'Properties'],
        ['message_publish_modal.field.headers.extra', '{{example}}'],
        ['message_publish_modal.field.properties.extra', '{{example}}'],
      ].forEach(([key, rawTerm]) => {
        expect(catalog[key]).toContain(rawTerm);
      });
    });
  });
});
