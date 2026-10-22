const exporterID = /^[a-z][a-z0-9_.-]{0,63}$/;
const exporterExtension = /^[a-z0-9]{1,16}$/;
const exporterType = /^(text|application)\/[a-z0-9][a-z0-9.+-]{0,63}$/;
export function validateExporter(exporter: { id: string; name: string; command: string; extension: string; contentType: string; streaming?: boolean }): void {
  if (!exporterID.test(exporter.id) || exporter.command === '' || exporter.name.trim() === '' || new TextEncoder().encode(exporter.name).length > 256 || exporter.name.includes('\u0000')) {
    throw new Error('invalid exporter identity');
  }
  if (!exporterExtension.test(exporter.extension) || !exporterType.test(exporter.contentType)) throw new Error('invalid exporter extension or content type');
  if (exporter.streaming !== undefined && typeof exporter.streaming !== 'boolean') throw new Error('invalid exporter streaming flag');
}
