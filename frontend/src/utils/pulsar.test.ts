import { describe, expect, it } from 'vitest';
import { buildMessagePublishCommand, createDefaultMessagePublishDraft, getMessagePublishPresentation } from './messagePublish';
import { buildMessageConsumeCommand, resolveMessageConsumeProfile } from './messageConsume';
import { parseUriToValues, buildUriFromValues } from '../components/connectionModal/connectionModalUri';
import { isMessageQueueDataSource } from './dataSourceCapabilities';
import { getConnectionTypeDefaultPort, getAllConnectionTypeCatalogItems } from './connectionTypeCatalog';
import { PRIMARY_USERNAME_OPTIONAL_TYPES, supportsSSLForType } from './connectionTypeCapabilities';
import { buildTableSelectQuery } from './objectQueryTemplates';

const config = { type: 'pulsar', database: 'persistent://public/default/orders' };

describe('Pulsar integration', () => {
  it('registers connection defaults, anonymous auth and intact dotted topic templates', () => {
    expect(getAllConnectionTypeCatalogItems().some(item => item.key === 'pulsar')).toBe(true);
    expect(getConnectionTypeDefaultPort('pulsar')).toBe(6650);
    expect(PRIMARY_USERNAME_OPTIONAL_TYPES.has('pulsar')).toBe(true);
    expect(supportsSSLForType('pulsar')).toBe(true);
    expect(buildTableSelectQuery('pulsar', 'persistent://public/default/orders.events')).toBe('SELECT * FROM "persistent://public/default/orders.events" LIMIT 100;');
    expect(parseUriToValues('pulsar+ssl://localhost/public/default/orders?sslCAPath=root.pem', 'pulsar')).toMatchObject({ port: 6651, useSSL: true, sslCAPath: 'root.pem' });
  });
  it('uses the message workbench and read-only preview without consumer group controls', () => {
    expect(isMessageQueueDataSource(config)).toBe(true);
    expect(resolveMessageConsumeProfile(config)).toMatchObject({ type: 'pulsar', showConsumerGroup: false });
    expect(buildMessageConsumeCommand(config, { destination: config.database, limit: 10 }).commandText)
      .toBe('CONSUME FROM "persistent://public/default/orders" EARLIEST LIMIT 10;');
  });
  it('publishes JSON, keys and properties through the existing command API', () => {
    const draft = { ...createDefaultMessagePublishDraft(config), body: '{"n":1}', key: 'order-1', properties: '{"source":"test"}' };
    expect(JSON.parse(buildMessagePublishCommand(config, draft).commandText)).toEqual({ publish: config.database, value: { n: 1 }, key: 'order-1', properties: { source: 'test' } });
    expect(getMessagePublishPresentation(config)).toMatchObject({ showProperties: true, showHeaders: false, showKeyMode: false });
  });
  it('round trips TLS, topic and escaped authentication in URI mode', () => {
    const uri = buildUriFromValues({ ...config, host: 'localhost', port: 6651, user: 'user', password: 'p+a/ss', useSSL: true, sslMode: 'required' });
    expect(parseUriToValues(uri, 'pulsar')).toMatchObject({ host: 'localhost', port: 6651, database: config.database, password: 'p+a/ss', useSSL: true });
  });
});
