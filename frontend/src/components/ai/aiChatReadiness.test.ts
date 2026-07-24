import { describe, expect, it } from 'vitest';

import { buildAIChatReadinessSnapshot } from './aiChatReadiness';

describe('buildAIChatReadinessSnapshot', () => {
  it('defaults missing-provider status copy to English when no translator is provided', () => {
    const snapshot = buildAIChatReadinessSnapshot({
      providers: [],
      activeProviderId: '',
    });

    expect(snapshot.status).toBe('missing_provider');
    expect(snapshot.ready).toBe(false);
    expect(snapshot.action?.key).toBe('open-settings');
    expect(snapshot.label).toBe('Not ready');
    expect(snapshot.title).toBe('No provider available');
    expect(snapshot.description).toBe('Add and enable a model provider in AI settings first.');
    expect(snapshot.action?.label).toBe('Open AI settings');
  });

  it('defaults incomplete-provider status copy to English while keeping raw provider names', () => {
    const snapshot = buildAIChatReadinessSnapshot({
      providers: [{
        id: 'provider-1',
        type: 'custom',
        name: 'Custom proxy',
        apiKey: '',
        hasSecret: false,
        baseUrl: '',
        model: 'gpt-5.5',
        models: ['gpt-5.5'],
        maxTokens: 16000,
        temperature: 0.7,
      }],
      activeProviderId: 'provider-1',
    });

    expect(snapshot.status).toBe('provider_incomplete');
    expect(snapshot.issues).toEqual(['missing_secret', 'missing_base_url']);
    expect(snapshot.label).toBe('Needs fix');
    expect(snapshot.title).toBe('Custom proxy is missing API key, endpoint URL');
    expect(snapshot.description).toBe('Complete the provider configuration before sending to avoid immediate request failures.');
    expect(snapshot.action?.label).toBe('Fix provider configuration');
    expect(snapshot.message).toContain('Custom proxy is missing API key, endpoint URL');
  });

  it('defaults missing-model status copy to English when no translator is provided', () => {
    const snapshot = buildAIChatReadinessSnapshot({
      providers: [{
        id: 'provider-1',
        type: 'openai',
        name: 'OpenAI Primary',
        apiKey: '',
        hasSecret: true,
        baseUrl: 'https://api.openai.com/v1',
        model: '',
        models: ['gpt-5.5', 'gpt-4.1'],
        maxTokens: 32000,
        temperature: 0.2,
      }],
      activeProviderId: 'provider-1',
    });

    expect(snapshot.status).toBe('missing_model');
    expect(snapshot.selectableModelCount).toBe(2);
    expect(snapshot.action?.key).toBe('reload-models');
    expect(snapshot.label).toBe('Model required');
    expect(snapshot.title).toBe('Select a model for OpenAI Primary');
    expect(snapshot.description).toBe('2 models are available right now. Select one before sending.');
    expect(snapshot.action?.label).toBe('Reload models');
  });

  it('defaults ready status copy to English while preserving raw provider and model values', () => {
    const snapshot = buildAIChatReadinessSnapshot({
      providers: [{
        id: 'provider-1',
        type: 'openai',
        name: 'OpenAI Primary',
        apiKey: '',
        hasSecret: true,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.5',
        models: ['gpt-5.5'],
        maxTokens: 32000,
        temperature: 0.2,
      }],
      activeProviderId: 'provider-1',
      activeContext: {
        connectionId: 'conn-1',
        dbName: 'demo',
      },
      activeContextItems: [{
        dbName: 'demo',
        tableName: 'orders',
        ddl: 'CREATE TABLE orders (...)',
      }],
    });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.ready).toBe(true);
    expect(snapshot.contextAttachedCount).toBe(1);
    expect(snapshot.label).toBe('Ready');
    expect(snapshot.title).toBe('AI is ready: OpenAI Primary / gpt-5.5');
    expect(snapshot.description).toBe('1 table schema contexts are attached. You can send now.');
  });

  it('treats CodeBuddy CLI as ready without explicit base url or model', () => {
    const snapshot = buildAIChatReadinessSnapshot({
      providers: [{
        id: 'provider-1',
        type: 'custom',
        name: 'CodeBuddy',
        apiKey: '',
        hasSecret: true,
        baseUrl: '',
        model: '',
        apiFormat: 'codebuddy-cli',
        models: [],
        maxTokens: 4096,
        temperature: 0.2,
      }],
      activeProviderId: 'provider-1',
    });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.ready).toBe(true);
    expect(snapshot.title).toContain('CodeBuddy');
    expect(snapshot.title).toContain('Auto-selected');
  });

  it('treats Cursor Agent as ready without an explicit model', () => {
    const snapshot = buildAIChatReadinessSnapshot({
      providers: [{
        id: 'provider-1',
        type: 'custom',
        name: 'Cursor',
        apiKey: '',
        hasSecret: true,
        baseUrl: 'https://api.cursor.com/v1',
        model: '',
        apiFormat: 'cursor-agent',
        models: [],
        maxTokens: 4096,
        temperature: 0.2,
      }],
      activeProviderId: 'provider-1',
    });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.ready).toBe(true);
    expect(snapshot.title).toContain('Cursor');
    expect(snapshot.title).toContain('Auto-selected');
  });

  it('treats a local CLI subscription as ready without secret, endpoint, or model', () => {
    const snapshot = buildAIChatReadinessSnapshot({
      providers: [{
        id: 'provider-codex',
        type: 'custom',
        name: 'Codex Subscription',
        apiKey: '',
        hasSecret: false,
        authMode: 'local-cli',
        baseUrl: '',
        model: '',
        apiFormat: 'codex-cli',
        models: [],
        maxTokens: 4096,
        temperature: 0.2,
      }],
      activeProviderId: 'provider-codex',
    });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.issues).toEqual([]);
    expect(snapshot.title).toContain('Auto-selected');
  });

  it('does not waive API provider requirements for an invalid local-cli flag', () => {
    const snapshot = buildAIChatReadinessSnapshot({
      providers: [{
        id: 'provider-invalid',
        type: 'custom',
        name: 'Invalid local CLI',
        apiKey: '',
        hasSecret: false,
        authMode: 'local-cli',
        baseUrl: '',
        model: '',
        apiFormat: 'openai',
        models: [],
        maxTokens: 4096,
        temperature: 0.2,
      }],
      activeProviderId: 'provider-invalid',
    });

    expect(snapshot.status).toBe('provider_incomplete');
    expect(snapshot.issues).toEqual(['missing_secret', 'missing_base_url', 'missing_selected_model']);
  });
});
