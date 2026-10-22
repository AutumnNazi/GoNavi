import { ProtocolError } from './protocol.js';

export function exportFault(code = 'invalid_request'): never { throw new ProtocolError(-32020, code); }
export type ExportBudget = { nodes: number };

/** Count UTF-8 without replacing unpaired UTF-16 surrogates or allocating an encoded copy. */
export function exportBytes(text: string, maximum: number): number {
 if (text.length > maximum) exportFault('limit_exceeded');
 let size = 0;
 for (let index = 0; index < text.length; index++) {
  const code = text.charCodeAt(index);
  if (code < 0x80) size++; else if (code < 0x800) size += 2;
  else if (code >= 0xd800 && code <= 0xdbff) {
   const low = text.charCodeAt(++index);
   if (!(low >= 0xdc00 && low <= 0xdfff)) exportFault(); size += 4;
  } else { if (code >= 0xdc00 && code <= 0xdfff) exportFault(); size += 3; }
  if (size > maximum) exportFault('limit_exceeded');
 }
 return size;
}

/** Lexically validate JSON; numbers are never converted to JavaScript Number. */
export class ExportJSONScanner {
 private index = 0;
 argumentsSpan?: { start: number; end: number };
 versionToken?: string;
 constructor(private readonly raw: string, private readonly budget: ExportBudget,
  private readonly maximumDepth = 32, private readonly maximumNodes = 131072) {}
 scan(depth = 0): void { this.value(depth, []); this.space(); if (this.index !== this.raw.length) exportFault(); }
 private space(): void { while (this.index < this.raw.length && ' \t\r\n'.includes(this.raw[this.index])) this.index++; }
 private value(depth: number, path: readonly string[] | undefined): void {
  if (depth > this.maximumDepth || ++this.budget.nodes > this.maximumNodes) exportFault('limit_exceeded');
  this.space(); const start = this.index; const char = this.raw[this.index];
  if (char === '{') this.object(depth, path);
  else if (char === '[') this.array(depth);
  else if (char === '"') this.string();
  else if (char === '-' || (char >= '0' && char <= '9')) this.number();
  else {
   const literal = ['true', 'false', 'null'].find((candidate) => this.raw.startsWith(candidate, this.index));
   if (!literal) exportFault(); this.index += literal.length;
  }
  if (path?.length === 1 && path[0] === 'protocolVersion') this.versionToken = this.raw.slice(start, this.index);
  if (path?.length === 2 && path[0] === 'params' && path[1] === 'arguments') this.argumentsSpan = { start, end: this.index };
 }
 private object(depth: number, path: readonly string[] | undefined): void {
  this.index++; this.space(); const keys = new Set<string>();
  if (this.raw[this.index] === '}') { this.index++; return; }
  for (;;) {
   this.space(); const key = this.string();
   if (keys.has(key)) exportFault(); keys.add(key);
   this.space(); if (this.raw[this.index++] !== ':') exportFault();
   this.value(depth + 1, path !== undefined && path.length < 2 ? [...path, key] : undefined);
   this.space(); const end = this.raw[this.index++];
   if (end === '}') return; if (end !== ',') exportFault();
  }
 }
 private array(depth: number): void {
  this.index++; this.space(); if (this.raw[this.index] === ']') { this.index++; return; }
  for (;;) { this.value(depth + 1, undefined); this.space(); const end = this.raw[this.index++]; if (end === ']') return; if (end !== ',') exportFault(); }
 }
 private string(): string {
  const start = this.index; if (this.raw[this.index++] !== '"') exportFault();
  while (this.index < this.raw.length) {
   const code = this.raw.charCodeAt(this.index++);
   if (code === 34) {
    let value: unknown;
    try { value = JSON.parse(this.raw.slice(start, this.index)); } catch { exportFault(); }
    if (typeof value !== 'string') exportFault(); exportBytes(value, 1 << 20); return value;
   }
   if (code < 32) exportFault();
   if (code !== 92) continue;
   const escaped = this.raw[this.index++];
   if (escaped === 'u') {
    if (!/^[0-9a-fA-F]{4}$/.test(this.raw.slice(this.index, this.index + 4))) exportFault(); this.index += 4;
   } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) exportFault();
  }
  exportFault();
 }
 private number(): void {
  if (this.raw[this.index] === '-') this.index++;
  if (this.raw[this.index] === '0') this.index++;
  else { if (!(this.raw[this.index] >= '1' && this.raw[this.index] <= '9')) exportFault(); this.digits(); }
  if (this.raw[this.index] === '.') { this.index++; this.requiredDigits(); }
  if (this.raw[this.index] === 'e' || this.raw[this.index] === 'E') {
   this.index++; if (this.raw[this.index] === '+' || this.raw[this.index] === '-') this.index++; this.requiredDigits();
  }
 }
 private digits(): void { while (this.raw[this.index] >= '0' && this.raw[this.index] <= '9') this.index++; }
 private requiredDigits(): void { const before = this.index; this.digits(); if (this.index === before) exportFault(); }
}

export function exporterArguments(frame: string): string {
 exportBytes(frame, 1 << 20);
 // The two RPC wrapper levels are not charged to the export envelope's depth or bytes.
 const scanner = new ExportJSONScanner(frame, { nodes: 0 }, 34, 262144); scanner.scan();
 if (!scanner.argumentsSpan) exportFault();
 return frame.slice(scanner.argumentsSpan.start, scanner.argumentsSpan.end);
}
