import React from 'react';
import { Form, Input, Select, type FormInstance } from 'antd';
import { t } from '../../i18n';
import { noAutoCapInputProps } from '../../utils/inputAutoCap';
import { normalizeConnectionParamsText } from './connectionModalUri';

const mechanismKeys = ['mechanism', 'saslMechanism', 'sasl_mechanism', 'sasl',
  'sasl.mechanism', 'sasl.mechanisms', 'librdkafka.sasl.mechanism', 'librdkafka.sasl.mechanisms'];
const protocolKeys = ['security.protocol', 'librdkafka.security.protocol'];

export function useKafkaSecuritySync(form: FormInstance, kafka: boolean, setUseSSL: (enabled: boolean) => void) {
  const uri = Form.useWatch('uri', { form, preserve: true });
  const params = Form.useWatch('connectionParams', { form, preserve: true });
  const useSSL = Form.useWatch('useSSL', { form, preserve: true });
  const sslMode = Form.useWatch('sslMode', { form, preserve: true });
  React.useEffect(() => {
    if (!kafka) return;
    if (!readExplicitKafkaSecurityProtocol(form.getFieldValue('uri'), form.getFieldValue('connectionParams'))) {
      setUseSSL(!!form.getFieldValue('useSSL'));
      return;
    }
    const protocol = readKafkaSecurityProtocol(form.getFieldValue('uri'), form.getFieldValue('connectionParams'), !!form.getFieldValue('useSSL'));
    const tls = protocol === 'SSL' || protocol === 'SASL_SSL';
    const mode = tls ? (form.getFieldValue('sslMode') === 'skip-verify' ? 'skip-verify' : 'required') : 'disable';
    if (form.getFieldValue('useSSL') !== tls || form.getFieldValue('sslMode') !== mode) form.setFieldsValue({ useSSL: tls, sslMode: mode });
    setUseSSL(tls);
  }, [form, kafka, uri, params, useSSL, sslMode, setUseSSL]);
}

export function readExplicitKafkaSecurityProtocol(uri: unknown, connectionParams: unknown): string | undefined {
  const params = new URLSearchParams(normalizeConnectionParamsText(String(uri || '').split('?')[1] || ''));
  new URLSearchParams(normalizeConnectionParamsText(connectionParams)).forEach((value, key) => params.set(key, value));
  return protocolKeys.map(key => params.get(key)?.trim().toUpperCase()).find(Boolean);
}

export function readKafkaSecurityProtocol(uri: unknown, connectionParams: unknown, useSSL = false): string {
  const explicit = readExplicitKafkaSecurityProtocol(uri, connectionParams);
  if (explicit) return explicit;
  return (readKafkaAuthMechanism(uri, connectionParams) !== 'none' ? 'SASL_' : '') + (useSSL ? 'SSL' : 'PLAINTEXT');
}

export function writeKafkaSecurityProtocol(connectionParams: unknown, protocol: string, mechanism: string): string {
  const params = new URLSearchParams(writeKafkaAuthMechanism(connectionParams,
    protocol.startsWith('SASL_') ? (mechanism === 'none' ? 'plain' : mechanism) : 'none'));
  protocolKeys.forEach(key => params.delete(key));
  params.set('security.protocol', protocol);
  return params.toString();
}

export function ConnectionModalKafkaCredentials({ kafka, children }: { kafka: boolean; children: React.ReactNode }) {
  return <Form.Item noStyle shouldUpdate>{form => !kafka || readKafkaSecurityProtocol(form.getFieldValue('uri'),
    form.getFieldValue('connectionParams'), form.getFieldValue('useSSL')).startsWith('SASL_') ? children : null}</Form.Item>;
}

export function readKafkaAuthMechanism(uri: unknown, connectionParams: unknown): string {
  const params = new URLSearchParams(normalizeConnectionParamsText(String(uri || '').split('?')[1] || ''));
  new URLSearchParams(normalizeConnectionParamsText(connectionParams)).forEach((value, key) => params.set(key, value));
  const raw = mechanismKeys.map(key => params.get(key)?.trim()).find(Boolean)?.toLowerCase() || 'none';
  if (raw === 'sasl_plaintext') return 'plain';
  if (['scram_sha_256', 'scram256'].includes(raw)) return 'scram-sha-256';
  if (['scram_sha_512', 'scram512'].includes(raw)) return 'scram-sha-512';
  return raw;
}

export function writeKafkaAuthMechanism(connectionParams: unknown, mechanism: string): string {
  const params = new URLSearchParams(normalizeConnectionParamsText(connectionParams));
  mechanismKeys.forEach(key => params.delete(key));
  // The canonical key overrides every URI alias, including when disabling SASL.
  params.set('mechanism', mechanism);
  return params.toString();
}

export default function ConnectionModalKafkaAuth({ onChange, onTLSChange }: { onChange?: () => void; onTLSChange?: (enabled: boolean) => void }) {
  return <Form.Item noStyle shouldUpdate={(previous, next) => previous.uri !== next.uri || previous.connectionParams !== next.connectionParams || previous.useSSL !== next.useSSL}>
    {form => {
      const value = readKafkaAuthMechanism(form.getFieldValue('uri'), form.getFieldValue('connectionParams'));
      const protocol = readKafkaSecurityProtocol(form.getFieldValue('uri'), form.getFieldValue('connectionParams'), form.getFieldValue('useSSL'));
      const options = [
        { value: 'plain', label: 'PLAIN' },
        { value: 'scram-sha-256', label: 'SCRAM-SHA-256' },
        { value: 'scram-sha-512', label: 'SCRAM-SHA-512' },
      ];
      if (!options.some(option => option.value === value)) options.push({ value, label: value });
      return <><div className="gn-conn-f-row">
        <label className="gn-conn-f-label" htmlFor="kafka-security-protocol">{t('connection.modal.kafka.security_protocol')}</label>
        <div className="gn-conn-f-ctrl"><Select id="kafka-security-protocol" style={{ width: '100%' }} value={protocol}
          options={['PLAINTEXT', 'SSL', 'SASL_PLAINTEXT', 'SASL_SSL'].map(item => ({ value: item, label: item }))}
          onChange={next => {
            const tls = next === 'SSL' || next === 'SASL_SSL';
            form.setFieldsValue({ connectionParams: writeKafkaSecurityProtocol(form.getFieldValue('connectionParams'), next, value),
              useSSL: tls, sslMode: tls ? (form.getFieldValue('sslMode') === 'skip-verify' ? 'skip-verify' : 'required') : 'disable' });
            onTLSChange?.(tls);
            onChange?.();
          }} /></div>
      </div>{protocol.startsWith('SASL_') && <div className="gn-conn-f-row">
        <label className="gn-conn-f-label" htmlFor="kafka-auth-mechanism">{t('connection.modal.kafka.sasl_mechanism')}</label>
        <div className="gn-conn-f-ctrl">
          <Select id="kafka-auth-mechanism" aria-label={t('connection.modal.kafka.sasl_mechanism')} value={value === 'none' ? undefined : value} options={options.filter(option => option.value !== 'none')}
            style={{ width: '100%' }} onChange={next => {
              form.setFieldValue('connectionParams', writeKafkaAuthMechanism(form.getFieldValue('connectionParams'), next));
              onChange?.();
            }} />
        </div>
      </div>}</>;
    }}
  </Form.Item>;
}

export function ConnectionModalAdditionalParams({ placeholder }: { placeholder: string }) {
  return <Form.Item name="connectionParams" label={t('connection.modal.connectionParams.label')}
    help={t('connection.modal.connectionParams.help')} style={{ marginBottom: 0 }}>
    <Input.TextArea {...noAutoCapInputProps} rows={3} placeholder={placeholder} />
  </Form.Item>;
}
