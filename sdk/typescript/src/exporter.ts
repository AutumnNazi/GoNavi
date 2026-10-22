import { ProtocolError } from './protocol.js';
import type { Handler } from './protocol.js';
import type { ExporterHandlers, ExporterRender, ExporterResult } from './exportTypes.js';
import { copyExporterSnapshot, exportRecord, exporterID, exporterChunkResult, exporterResult, parseExporterRequest, validateExporterRequest } from './exportValidation.js';
import { exportFault, exporterArguments } from './exportJson.js';

export * from './exportTypes.js';
export { parseExporterRequest, validateExporterRequest } from './exportValidation.js';

/** One-shot, instance-owned exporter routing. Callbacks share the RPC lifetime, not an independent session. */
export class ExporterDispatcher {
 private readonly handlers = new Map<string, ExporterRender>();
 constructor(handlers: ExporterHandlers) {
  const values = exportRecord(handlers); const entries = Object.entries(values);
  if (!entries.length || entries.length > 8) exportFault();
  for (const [id, render] of entries) { if (!exporterID(id) || typeof render !== 'function') exportFault(); this.handlers.set(id, render as ExporterRender); }
 }
 /** The optional raw-frame hook is consumed automatically by Protocol before any render callback. */
 readonly handle: Handler = Object.assign(async (input: unknown, signal: AbortSignal): Promise<ExporterResult> => {
  if (!signal || signal.aborted) exportFault('canceled');
  const controller = new AbortController(); let deadline = false;
  const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { deadline = true; controller.abort(); }, 10000);
  try {
   const request = validateExporterRequest(input);
   const render = this.handlers.get(request.exporterId); if (!render) exportFault('unsupported');
   const snapshot = copyExporterSnapshot(request); const rowCount = snapshot.rows.length;
   if (signal.aborted || controller.signal.aborted) exportFault(deadline ? 'deadline' : 'canceled');
   let text: unknown;
   try { text = await render(snapshot, controller.signal); } catch { exportFault(controller.signal.aborted ? (deadline ? 'deadline' : 'canceled') : 'render_failed'); }
   if (signal.aborted || controller.signal.aborted) exportFault(deadline ? 'deadline' : 'canceled');
   return request.protocolVersion === 2 ? exporterChunkResult(text, request.exporterId, request.chunkIndex as number, rowCount) : exporterResult(text, rowCount);
  } catch (error: unknown) {
   if (error instanceof ProtocolError && ['invalid_request', 'invalid_result', 'limit_exceeded', 'unsupported', 'canceled', 'deadline', 'render_failed'].includes(error.message)) throw error;
   exportFault();
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
 }, { validateInvokeFrame: (frame: string): void => { parseExporterRequest(exporterArguments(frame)); } });
}
