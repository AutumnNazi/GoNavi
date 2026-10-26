export const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;

/** Incremental UTF-8 newline framing with a bounded partial-frame buffer. */
export class FrameReader {
  private readonly buffer: Uint8Array;
  private length = 0;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  constructor(private readonly onFrame: (frame: string) => void, maxBytes = DEFAULT_MAX_FRAME_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('invalid frame limit');
    this.buffer = new Uint8Array(maxBytes);
  }

  push(chunk: Uint8Array): void {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      const segment = chunk.subarray(start, end);
      if (this.length + segment.length > this.buffer.length) throw new Error('request exceeds frame limit');
      this.buffer.set(segment, this.length);
      this.length += segment.length;
      if (newline < 0) return;
      const frame = this.decoder.decode(this.buffer.subarray(0, this.length));
      this.length = 0;
      this.onFrame(frame.endsWith('\r') ? frame.slice(0, -1) : frame);
      start = newline + 1;
    }
  }

  /** Reject an incomplete final frame instead of silently executing partial input. */
  end(): void {
    if (this.length !== 0) throw new Error('incomplete protocol frame');
  }
}
