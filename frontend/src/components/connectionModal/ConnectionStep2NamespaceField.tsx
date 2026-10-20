import { Form, Input } from 'antd';
import { t } from '../../i18n';
import { noAutoCapInputProps } from '../../utils/inputAutoCap';
import type { ConnectionStep2UriBlockApi } from './connectionStep2UriBlock';
import { getInterSystemsURINamespace, INTERSYSTEMS_STORED_URI_FIELD, usesInterSystemsNamespace } from './connectionModalNamespace';

interface ConnectionStep2NamespaceFieldProps {
  dbType: string;
  denseLabel: ConnectionStep2UriBlockApi['denseLabel'];
}

export const ConnectionStep2NamespaceField = ({
  dbType,
  denseLabel,
}: ConnectionStep2NamespaceFieldProps) => {
  // The URI editor lives in a collapsed panel and may not have a registered field yet.
  const uri = Form.useWatch('uri', { preserve: true });
  const hasStoredURI = Form.useWatch(INTERSYSTEMS_STORED_URI_FIELD, { preserve: true });
  const uriNamespace = getInterSystemsURINamespace(dbType, uri);
  const hasOpaqueTarget = hasStoredURI === true && !String(uri || '').trim();
  if (!usesInterSystemsNamespace(dbType)) return null;
  return (
    <div className="gn-conn-f-row" data-align="start">
      {denseLabel(t('connection_modal.field.intersystemsNamespace.label'))}
      <div className="gn-conn-f-ctrl">
        {uriNamespace ? (
          <Input
            {...noAutoCapInputProps}
            aria-label={t('connection_modal.field.intersystemsNamespace.label')}
            value={uriNamespace}
            disabled
          />
        ) : (
          <Form.Item name="database" style={{ marginBottom: 0 }}>
            <Input
              {...noAutoCapInputProps}
              aria-label={t('connection_modal.field.intersystemsNamespace.label')}
              disabled={hasOpaqueTarget}
              placeholder={t(hasOpaqueTarget
                ? 'connection_modal.field.intersystemsNamespace.storedUri.placeholder'
                : 'connection_modal.field.intersystemsNamespace.placeholder')}
            />
          </Form.Item>
        )}
        <div className="gn-conn-mode-hint">
          {t(hasOpaqueTarget
            ? 'connection_modal.field.intersystemsNamespace.storedUri.help'
            : 'connection_modal.field.intersystemsNamespace.help')}
        </div>
      </div>
    </div>
  );
};
