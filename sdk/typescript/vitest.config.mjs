import { fileURLToPath } from 'node:url';

// Reuse the repository's installed runner; the SDK itself has no dependencies.
export default {
  resolve: { alias: { vitest: fileURLToPath(new URL('../../frontend/node_modules/vitest/dist/index.js', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'], environment: 'node', maxWorkers: 1 },
};
