/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Form, type FormInstance } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCurrentLanguage, t } from '../../i18n';
import { ConnectionStep2NamespaceField } from './ConnectionStep2NamespaceField';
import { buildConnectionConfig } from './connectionModalConfig';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));

type NamespaceFormValues = { database: string; uri: string; intersystemsHasStoredURI: boolean };

const renderField = async (type: string, initial = '', uri = '', registerUri = true, hasStoredURI = false) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let form: FormInstance<NamespaceFormValues> | undefined;
  const Harness = () => {
    const [instance] = Form.useForm<NamespaceFormValues>();
    form = instance;
    return <Form form={instance} initialValues={{ database: initial, uri, intersystemsHasStoredURI: hasStoredURI }}>
      {registerUri && <Form.Item name="uri" hidden><input /></Form.Item>}
      <ConnectionStep2NamespaceField dbType={type} denseLabel={(label) => <span>{label}</span>} />
    </Form>;
  };
  await act(async () => root.render(<Harness />));
  return {
    host,
    form: () => form!,
    input: () => host.querySelector<HTMLInputElement>('input[aria-label]')!,
    cleanup: async () => { await act(async () => root.unmount()); host.remove(); },
  };
};

const editInput = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('InterSystems namespace form field', () => {
  afterEach(() => setCurrentLanguage('zh-CN'));

  it.each(['iris', 'cache'])('binds %s input edits to the tested and saved database value', async (type) => {
    setCurrentLanguage('en-US');
    const view = await renderField(type, 'OLD_NAMESPACE');
    try {
      expect(view.input().value).toBe('OLD_NAMESPACE');
      expect(view.input().getAttribute('aria-label')).toBe('Namespace (optional)');
      expect(view.host.textContent).toContain('Database display scope only filters results');
      await act(async () => editInput(view.input(), 'APP_DATA'));
      expect(view.form().getFieldValue('database')).toBe('APP_DATA');
      for (const forPersist of [false, true]) {
        const config = await buildConnectionConfig({ values: { type, ...view.form().getFieldsValue(true) }, forPersist, translate: t });
        expect(config.database).toBe('APP_DATA');
      }
      await act(async () => editInput(view.input(), ''));
      await expect(view.form().validateFields()).resolves.toMatchObject({ database: '' });
      for (const forPersist of [false, true]) {
        const config = await buildConnectionConfig({ values: { type, ...view.form().getFieldsValue(true) }, forPersist, translate: t });
        expect(config.database).toBe('');
      }
    } finally { await view.cleanup(); }
  });

  it.each(['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const)('translates the namespace label and help in %s', async (language) => {
    setCurrentLanguage(language);
    const view = await renderField('cache');
    try {
      expect(view.host.textContent).toContain(t('connection_modal.field.intersystemsNamespace.label'));
      expect(view.host.textContent).toContain(t('connection_modal.field.intersystemsNamespace.help'));
      expect(view.input().placeholder).toBe(t('connection_modal.field.intersystemsNamespace.placeholder'));
      expect(view.host.textContent).not.toContain('connection_modal.field.intersystemsNamespace');
    } finally { await view.cleanup(); }
  });

  it.each(['iris', 'cache'])('locks the effective URI target and unlocks manual editing after clearing it for %s', async (type) => {
    setCurrentLanguage('en-US');
    const view = await renderField(type, 'OLD_NAMESPACE', `${type}://user@localhost:1972/URI_APP`);
    try {
      expect(view.input().value).toBe('URI_APP');
      expect(view.input().disabled).toBe(true);
      expect(view.host.textContent).toContain('edit or clear the URI to change it');
      await act(async () => view.form().setFieldValue('uri', 'jdbc:intersystems-cache://localhost:1972//%25SYS//?timeout=30'));
      expect(view.input().value).toBe('%SYS');
      expect(view.input().disabled).toBe(true);
      for (const forPersist of [false, true]) {
        const config = await buildConnectionConfig({ values: { type, ...view.form().getFieldsValue(true) }, forPersist, translate: t });
        expect(config.database).toBe('%SYS');
      }
      await act(async () => view.form().setFieldValue('uri', ''));
      expect(view.input().disabled).toBe(false);
      expect(view.input().value).toBe('OLD_NAMESPACE');
      await act(async () => editInput(view.input(), 'NEW_APP'));
      for (const forPersist of [false, true]) {
        const config = await buildConnectionConfig({ values: { type, ...view.form().getFieldsValue(true) }, forPersist, translate: t });
        expect(config.database).toBe('NEW_APP');
        expect(config.uri).toBe('');
      }
    } finally { await view.cleanup(); }
  });

  it.each(['iris', 'cache'])('watches %s URI values even before the collapsed URI editor mounts', async (type) => {
    const view = await renderField(type, 'OLD_NAMESPACE', `${type}://localhost:1972/URI_APP`, false);
    try {
      expect(view.input().disabled).toBe(true);
      expect(view.input().value).toBe('URI_APP');
      await act(async () => view.form().setFieldValue('uri', `${type}://localhost:1972/NEXT_APP`));
      expect(view.input().value).toBe('NEXT_APP');
    } finally { await view.cleanup(); }
  });

  it.each(['iris', 'cache'])('does not lock %s fields for a URI with no explicit namespace', async (type) => {
    const view = await renderField(type, '', `${type}://localhost:1972/`);
    try {
      expect(view.input().disabled).toBe(false);
      expect(view.input().value).toBe('');
      await act(async () => editInput(view.input(), 'MANUAL_APP'));
      expect(view.form().getFieldValue('database')).toBe('MANUAL_APP');
    } finally { await view.cleanup(); }
  });

  it.each(['iris', 'cache'])('does not allow %s namespace edits to be silently overridden by a stored URI', async (type) => {
    setCurrentLanguage('en-US');
    const view = await renderField(type, '', '', false, true);
    try {
      expect(view.input().disabled).toBe(true);
      expect(view.input().placeholder).toBe('Controlled by the saved connection URI');
      expect(view.host.textContent).toContain('clear the saved URI, save and reopen');
      await act(async () => view.form().setFieldValue('uri', `${type}://localhost:1972/NEW_APP`));
      expect(view.input().disabled).toBe(true);
      expect(view.input().value).toBe('NEW_APP');
      expect(view.host.textContent).not.toContain('clear the saved URI, save and reopen');
      await act(async () => view.form().setFieldValue('uri', `${type}://localhost:1972/`));
      expect(view.input().disabled).toBe(false);
      await act(async () => editInput(view.input(), 'MANUAL_APP'));
      expect(view.form().getFieldValue('database')).toBe('MANUAL_APP');
    } finally { await view.cleanup(); }
  });

  it('does not add a namespace input for unrelated types', async () => {
    const view = await renderField('postgres');
    try { expect(view.input()).toBeNull(); }
    finally { await view.cleanup(); }
  });
});
