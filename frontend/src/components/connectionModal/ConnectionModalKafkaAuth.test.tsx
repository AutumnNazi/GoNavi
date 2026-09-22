/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Form, type FormInstance } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import ConnectionModalKafkaAuth, { ConnectionModalAdditionalParams, ConnectionModalKafkaCredentials, readKafkaAuthMechanism, writeKafkaAuthMechanism, readKafkaSecurityProtocol, writeKafkaSecurityProtocol } from './ConnectionModalKafkaAuth';
import { t } from '../../i18n';
import { buildConnectionConfig } from './connectionModalConfig';
import { useKafkaSecuritySync } from './ConnectionModalKafkaAuth';
import ConnectionModalNetworkSecuritySection from './ConnectionModalNetworkSecuritySection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));

describe('Kafka authentication selector', () => {
  it.each(['', 'security.protocol=SSL', 'librdkafka.security.protocol=SASL_SSL'])('offers preferred only without explicit TLS (%s)', async (connectionParams) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      const [form] = Form.useForm();
      return <Form form={form} initialValues={{ connectionParams, useSSL: true, sslMode: 'required' }}>
        <ConnectionModalNetworkSecuritySection dbType="kafka" form={form} activeNetworkConfig="ssl"
          setActiveNetworkConfig={() => {}} isSSLType useSSL sslMode="required" initialValues={{}}
          renderStoredSecretControls={() => null} />
      </Form>;
    }
    try {
      await act(async () => root.render(<Harness />));
      await act(async () => { host.querySelector('.ant-select-selector')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
      const labels = Array.from(document.querySelectorAll('.ant-select-item-option')).map(el => el.getAttribute('title'));
      expect(labels.includes(t('connection.modal.network.ssl_mode.preferred'))).toBe(connectionParams === '');
      expect(labels).toContain(t('connection.modal.network.ssl_mode.required'));
      expect(labels).toContain(t('connection.modal.network.ssl_mode.skip_verify'));
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it('preserves legacy preferred mode on mount and when selected again', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    let form: FormInstance;
    const setUseSSL = vi.fn();
    function Sync() { useKafkaSecuritySync(form!, true, setUseSSL); return null; }
    function Harness() {
      [form] = Form.useForm();
      return <Form form={form} initialValues={{ useSSL: true, sslMode: 'preferred', connectionParams: 'mechanism=plain' }}><Sync /></Form>;
    }
    try {
      await act(async () => root.render(<Harness />));
      expect(form!.getFieldValue('sslMode')).toBe('preferred');
      await act(async () => { form!.setFieldValue('sslMode', 'required'); });
      await act(async () => { form!.setFieldValue('sslMode', 'preferred'); });
      expect(form!.getFieldValue('sslMode')).toBe('preferred');
      expect(form!.getFieldValue('connectionParams')).toBe('mechanism=plain');
      expect(setUseSSL).toHaveBeenLastCalledWith(true);
    } finally { await act(async () => root.unmount()); }
  });
  it('synchronizes imported settings and later parameter changes while the basic controls are unmounted', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    let form: FormInstance;
    const setUseSSL = vi.fn();
    function Sync() {
      useKafkaSecuritySync(form!, true, setUseSSL);
      return null;
    }
    function Harness() {
      [form] = Form.useForm();
      return <Form form={form} initialValues={{ connectionParams: 'security.protocol=SASL_SSL&mechanism=plain', useSSL: false, sslMode: 'preferred' }}><Sync /></Form>;
    }
    try {
      await act(async () => root.render(<Harness />));
      expect(form!.getFieldValue('useSSL')).toBe(true);
      expect(form!.getFieldValue('sslMode')).toBe('required');
      expect(setUseSSL).toHaveBeenLastCalledWith(true);
      await act(async () => { form!.setFieldValue('connectionParams', 'security.protocol=SASL_PLAINTEXT&mechanism=plain'); });
      expect(form!.getFieldValue('useSSL')).toBe(false);
      expect(form!.getFieldValue('sslMode')).toBe('disable');
      await act(async () => { form!.setFieldsValue({ useSSL: true, connectionParams: 'security.protocol=SASL_SSL&mechanism=plain' }); });
      expect(form!.getFieldValue('sslMode')).toBe('required');
      await act(async () => { form!.setFieldValue('sslMode', 'skip-verify'); });
      expect(form!.getFieldValue('sslMode')).toBe('skip-verify');
    } finally { await act(async () => root.unmount()); }
  });
  it('translates the actual UI keys and keeps protocol and mechanisms distinct', () => {
    expect(t('connection.modal.kafka.security_protocol', undefined, 'zh-CN')).toBe('安全协议');
    expect(t('connection.modal.kafka.sasl_mechanism', undefined, 'zh-CN')).toBe('SASL 机制');
    for (const protocol of ['PLAINTEXT', 'SSL', 'SASL_PLAINTEXT', 'SASL_SSL']) {
      const params = writeKafkaSecurityProtocol('clientId=test', protocol, 'scram-sha-256');
      expect(readKafkaSecurityProtocol('', params)).toBe(protocol);
      expect(readKafkaAuthMechanism('', params)).toBe(protocol.startsWith('SASL_') ? 'scram-sha-256' : 'none');
    }
  });
  it('reads old URI aliases and preserves unrelated parameters when changing authentication', () => {
    const uri = 'kafka://user:pass@localhost:9092?librdkafka.sasl.mechanism=PLAIN';
    expect(readKafkaAuthMechanism(uri, '')).toBe('plain');
    const params = writeKafkaAuthMechanism('groupId=workers&sasl.mechanism=PLAIN&clientId=client', 'scram-sha-256');
    expect(readKafkaAuthMechanism(uri, params)).toBe('scram-sha-256');
    expect(new URLSearchParams(params).get('groupId')).toBe('workers');
    expect(new URLSearchParams(params).get('clientId')).toBe('client');
    expect(new URLSearchParams(params).has('sasl.mechanism')).toBe(false);
    expect(readKafkaAuthMechanism(uri, writeKafkaAuthMechanism(params, 'none'))).toBe('none');
    expect(readKafkaAuthMechanism('', 'mechanism=scram512')).toBe('scram-sha-512');
    expect(readKafkaAuthMechanism('', 'mechanism=custom')).toBe('custom');
  });

  it('writes the selected mechanism into the existing form and follows parameter changes', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let form: FormInstance;
    const onChange = vi.fn();
    function Harness() {
      [form] = Form.useForm();
      return <Form form={form} initialValues={{ connectionParams: 'mechanism=plain&groupId=workers' }}>
        <ConnectionModalKafkaAuth onChange={onChange} /><ConnectionModalAdditionalParams placeholder="" />
        <ConnectionModalKafkaCredentials kafka><span data-testid="credentials">credentials</span></ConnectionModalKafkaCredentials>
      </Form>;
    }
    try {
      await act(async () => root.render(<Harness />));
      expect(host.querySelector('#kafka-auth-mechanism')?.closest('.ant-select')?.textContent).toContain('PLAIN');
      await act(async () => {
        host.querySelector('#kafka-auth-mechanism')!.closest('.ant-select')!.querySelector('.ant-select-selector')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      const option = Array.from(document.querySelectorAll('.ant-select-item-option')).find(el => el.getAttribute('title') === 'SCRAM-SHA-256');
      expect(option).toBeTruthy();
      await act(async () => (option as HTMLElement).click());
      expect(new URLSearchParams(form!.getFieldValue('connectionParams')).get('mechanism')).toBe('scram-sha-256');
      expect(new URLSearchParams(form!.getFieldValue('connectionParams')).get('groupId')).toBe('workers');
      expect(onChange).toHaveBeenCalledOnce();
      await act(async () => { form!.setFieldValue('connectionParams', 'sasl.mechanism=SCRAM-SHA-512'); });
      expect(host.querySelector('#kafka-auth-mechanism')?.closest('.ant-select')?.textContent).toContain('SCRAM-SHA-512');
      await act(async () => {
        host.querySelector('#kafka-security-protocol')!.closest('.ant-select')!.querySelector('.ant-select-selector')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      const sslOption = document.querySelector('.ant-select-item-option[title="SSL"]') as HTMLElement;
      await act(async () => sslOption.click());
      expect(form!.getFieldValue('useSSL')).toBe(true);
      expect(form!.getFieldValue('sslMode')).toBe('required');
      expect(host.querySelector('#kafka-auth-mechanism')).toBeNull();
      expect(host.querySelector('[data-testid="credentials"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it.each([false, true])('keeps the selection through config assembly (persist=%s)', async (forPersist) => {
    const uri = 'kafka://test-user:test-pass@localhost:9092?librdkafka.sasl.mechanism=PLAIN';
    const config = await buildConnectionConfig({
      values: { type: 'kafka', uri, connectionParams: writeKafkaAuthMechanism('clientId=test', 'none'),
        kafkaTopology: 'single', kafkaHosts: [], timeout: 12, user: 'test-user', password: 'test+pass==' },
      forPersist, translate: key => key,
    });
    expect(readKafkaAuthMechanism(config.uri, config.connectionParams)).toBe('none');
    expect(config.password).toBe('test+pass==');
    expect(new URLSearchParams(config.connectionParams).get('clientId')).toBe('test');
  });
});
