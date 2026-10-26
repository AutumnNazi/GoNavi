export function validatePermissionNotes(manifest: { permissions: readonly string[]; permissionNotes?: Readonly<Record<string, string>> }): void {
  const notes = manifest.permissionNotes;
  if (notes == null) return;
  const granted = new Set(manifest.permissions);
  const entries = Object.entries(notes);
  if (entries.length > granted.size) throw new Error('permission note does not match a declared permission');
  for (const [key, value] of entries) {
    if (!granted.has(key) || !plainPermissionNote(value)) throw new Error('invalid permission note');
  }
}

function plainPermissionNote(value: string): boolean {
  if (typeof value !== 'string' || value.trim() === '' || new TextEncoder().encode(value).length > 160) return false;
  return !/[<>\u0000-\u001f\u007f]/.test(value);
}
