const commandID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export function validateCommand(command: { id: string; title: string; description?: string; effect?: string; inputSchema?: unknown }): void {
  const description = command.description ?? '';
  if (!commandID.test(command.id) || command.title.trim() === '' || new TextEncoder().encode(command.title).length > 256 || command.title.includes('\u0000')
    || new TextEncoder().encode(description).length > 4096) {
    throw new Error('invalid command declaration');
  }
  if (command.effect != null && command.effect !== '' && command.effect !== 'read' && command.effect !== 'write' && command.effect !== 'unknown') {
    throw new Error('unsupported command effect');
  }
  if (command.inputSchema == null) return;
  const encoded = JSON.stringify(command.inputSchema);
  if (encoded == null || encoded[0] !== '{' || new TextEncoder().encode(encoded).length > 64 * 1024) throw new Error('invalid command schema');
}
