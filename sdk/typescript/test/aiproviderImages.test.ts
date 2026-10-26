import { describe, expect, it } from 'vitest';
import type { AIProviderRegistration, AIProviderRequest } from '../src/aiproviderTypes.js';
import { start } from '../src/aiproviderValidation.js';
import { imageDataURL, validateImages } from '../src/aiproviderImages.js';

const models = [{ id: 'test-model', name: 'Local test', contextWindow: 1024, maxOutputTokens: 128 }];
const provider = (supportsImages: boolean): AIProviderRegistration => ({ models, supportsTools: false, supportsImages, generate: async () => ({ finishReason: 'stop' }) });
const image = (payload = 'aGVsbG8='): string => `data:image/png;base64,${payload}`;

function request(messages: AIProviderRequest['messages']): AIProviderRequest {
  return { messages, temperature: 0, maxTokens: 8 };
}

function wire(value: AIProviderRequest) {
  return { protocolVersion: 1, operation: 'start', providerId: 'one', requestId: 'image-start', config: { baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', model: 'test-model' }, request: value };
}

describe('AI provider images', () => {
  it('forwards bounded images only to declared providers', () => {
    const large = image('A'.repeat(768 * 1024));
    const value = request([{ role: 'user', content: 'describe', images: [large] }]);
    expect(start(wire(value), provider(true)).request.messages[0].images).toEqual([large]);
  });

  it.each([
    ['missing capability', false, request([{ role: 'user', content: 'x', images: [image()] }])],
    ['assistant image', true, request([{ role: 'assistant', content: 'x', images: [image()] }])],
    ['too many images', true, request([{ role: 'user', content: 'x', images: [image(), image(), image(), image(), image()] }])],
    ['empty array', true, request([{ role: 'user', content: 'x', images: [] }])],
    ['remote url', true, request([{ role: 'user', content: 'x', images: ['https://example.invalid/a.png'] }])],
    ['unsupported media type', true, request([{ role: 'user', content: 'x', images: ['data:image/svg+xml;base64,PHN2Zy8+'] }])],
    ['invalid base64', true, request([{ role: 'user', content: 'x', images: ['data:image/png;base64,!!!'] }])],
  ])('rejects %s', (_name, supportsImages, value) => {
    expect(() => start(wire(value as AIProviderRequest), provider(supportsImages as boolean))).toThrow();
  });

  it('checks the data URL shape directly', () => {
    expect(imageDataURL(image())).toBe(true);
    expect(imageDataURL('data:image/png,hello')).toBe(false);
    expect(imageDataURL('data:image/png;base64,')).toBe(false);
    expect(() => validateImages([{ role: 'assistant', content: '', images: [image()] }], true)).toThrow();
  });
});
