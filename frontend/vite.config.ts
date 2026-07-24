import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./src/test/setupI18nCatalogs.ts'],
  },
  optimizeDeps: {
    // Pre-bundle startup locale modules before Wails starts proxying the WebView.
    include: [
      'antd/locale/de_DE',
      'antd/locale/en_US',
      'antd/locale/ja_JP',
      'antd/locale/ru_RU',
      'antd/locale/zh_CN',
      'antd/locale/zh_TW',
      'dayjs/locale/de',
      'dayjs/locale/ja',
      'dayjs/locale/ru',
      'dayjs/locale/zh-cn',
      'dayjs/locale/zh-tw',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist', // Standard Wails output directory
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 拆分大体积三方依赖到独立 chunk，避免主 bundle 过大
        // reactflow + dagre 约 130KB gzipped，单独成 chunk 可按需加载
        // recharts 用于诊断面板统计条，与执行计划图无强依赖，单独 chunk
        manualChunks: {
          reactflow: ['reactflow'],
          dagre: ['dagre'],
          charts: ['recharts'],
        },
      },
    },
  }
})
