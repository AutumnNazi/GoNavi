import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Deliberately no React/main application imports: this runtime belongs only to
// the independent plugin window process, never the primary workbench thread.
export default defineConfig({
  build: {
    outDir: 'dist/plugin-window',
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/pluginWindow/runtime.ts', import.meta.url)),
      name: 'GoNaviPluginWindowRuntime',
      formats: ['iife'],
      fileName: () => 'runtime.js',
    },
  },
});
