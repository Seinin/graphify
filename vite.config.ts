import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Graphify 前端构建配置。
// 开发时由 server/index.mjs 以 middlewareMode 载入本配置，因此这里不单独启动 dev server。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5178,
    strictPort: false,
    allowedHosts: true,
    watch: {
      // 带截断的写入（编辑器/脚本先清空再落盘）会让 watcher 在文件中途被读取到，
      // 一旦此刻被转换就会把「空内容」缓存成该模块的产物，后续 change 事件未必再使其失效，
      // 于是浏览器链接期报「does not provide an export named …」而整页停在启动占位。
      // 等文件写入稳定后再上报事件，从源头避免读到半成品；代价只是 HMR 延迟 ≤120ms。
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5178,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // 按体积占比拆分第三方依赖，避免单个 chunk 过大影响首屏
        manualChunks: {
          graph: ['cytoscape', 'cytoscape-fcose'],
          // 数学渲染（remark-math / rehype-katex / katex）与 markdown 同 chunk：
          // 阅读器是懒加载的，这样 KaTeX 与字体不会进首屏的 graph chunk。
          markdown: [
            'react-markdown',
            'remark-gfm',
            'remark-math',
            'rehype-sanitize',
            'rehype-katex',
            'katex',
            'react-syntax-highlighter',
          ],
          charts: ['recharts'],
        },
      },
    },
  },
})
