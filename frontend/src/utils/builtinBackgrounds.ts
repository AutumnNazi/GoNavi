// Legacy selection metadata only. Artwork is never bundled or loaded from this list.
export const BUILTIN_BACKGROUNDS = [
  { id: 'whale-maid-a', nameKey: 'app.theme.background.builtin.maid_a' },
  { id: 'whale-maid-b', nameKey: 'app.theme.background.builtin.maid_b' },
] as const;

export type BuiltinBackgroundId = typeof BUILTIN_BACKGROUNDS[number]['id'];

// Existing v1 selections retain their IDs even when no local installation exists.
export function getBuiltinBackground(id: unknown) {
  return BUILTIN_BACKGROUNDS.find((background) => background.id === id) ?? null;
}

export const BACKGROUND_ARTWORK_SOURCE = 'https://github.com/Small-tailqwq/dsh-deep-whale';
export const BACKGROUND_ARTWORK_LICENSE = 'https://creativecommons.org/licenses/by-nc-sa/4.0/';
