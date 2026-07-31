import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new globalThis.URL('./DriverManagerModal.tsx', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');

describe('DriverManagerModal request coordination boundary', () => {
  it('lets the latest request clear a loading state even when it is a silent refresh', () => {
    expect(source).toMatch(
      /finally \{\s*if \(requestGeneration === statusRequestGenerationRef\.current\) \{\s*setLoading\(false\);/s,
    );
    expect(source).toMatch(
      /finally \{\s*if \(requestGeneration === networkRequestGenerationRef\.current\) \{\s*setNetworkChecking\(false\);/s,
    );
    expect(source).not.toContain('showLoading && requestGeneration === statusRequestGenerationRef.current');
    expect(source).not.toContain('showLoading && requestGeneration === networkRequestGenerationRef.current');
  });

  it('clears cold loading flags when another instance populated a fresh snapshot first', () => {
    expect(source).toMatch(/if \(cachedStatus\) \{\s*setRows\(cachedStatus\.rows\);\s*setLoading\(false\);/s);
    expect(source).toContain('downloadDirRef.current = cachedStatus.downloadDir;');
    expect(source).toMatch(/if \(cachedNetwork\) \{\s*setNetworkStatus\(cachedNetwork\.status\);\s*setNetworkChecking\(false\);/s);
  });

  it('keeps status snapshots keyed and rejects writes older than the latest intent for a directory', () => {
    expect(source).toContain('const driverStatusSnapshotCache = new Map<string, DriverStatusSnapshot>();');
    expect(source).toContain('const driverStatusSnapshotIntentByKey = new Map<string, number>();');
    expect(source).toContain('preferredDriverStatusSnapshotKey = requestKey;');
    expect(source).toContain('snapshot.intentSequence < latestIntentForKey');
    expect(source).toContain('writeDriverStatusSnapshot(resolvedRequestKey, snapshot);');
  });
});
