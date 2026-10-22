import type { AIProviderMessage } from './aiproviderTypes.js';
import { fault } from './aiproviderValidation.js';

/** Widest frame a declared image provider must be prepared to receive. */
export const AI_PROVIDER_IMAGE_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_DECODED_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_REQUEST_IMAGE_BYTES = 24 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodedBase64Bytes(payload: string): number | null {
  if (payload.length === 0 || payload.length % 4 !== 0) return null;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const body = payload.slice(0, payload.length - padding);
  if (!/^[A-Za-z0-9+/]+$/.test(body)) return null;
  const tail = ALPHABET.indexOf(body[body.length - 1]);
  if (padding === 2 && (tail & 0x0f) !== 0) return null;
  if (padding === 1 && (tail & 0x03) !== 0) return null;
  return (payload.length / 4) * 3 - padding;
}

export function imageDataURL(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const comma = value.indexOf(',');
  if (comma < 0) return false;
  const header = value.slice(0, comma);
  const payload = value.slice(comma + 1);
  if (!header.startsWith('data:') || !header.endsWith(';base64')) return false;
  const mediaType = header.slice('data:'.length, header.length - ';base64'.length);
  if (!MEDIA_TYPES.has(mediaType)) return false;
  const decoded = decodedBase64Bytes(payload);
  return decoded !== null && decoded > 0 && decoded <= MAX_IMAGE_DECODED_BYTES;
}

/** Images only travel on user messages and only for explicitly declared providers. */
export function validateImages(messages: readonly AIProviderMessage[], supportsImages: boolean): void {
  let total = 0;
  for (const message of messages) {
    if (!message.images || message.images.length === 0) continue;
    if (!supportsImages) fault('unsupported');
    if (message.role !== 'user' || message.images.length > MAX_IMAGES_PER_MESSAGE) fault('invalid_request');
    for (const image of message.images) {
      if (!imageDataURL(image)) fault('invalid_request');
      total += image.length;
      if (total > MAX_REQUEST_IMAGE_BYTES) fault('limit_exceeded');
    }
  }
}
