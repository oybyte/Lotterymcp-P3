import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
          react: ['react', 'react-dom/client'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4317',
      '/healthz': 'http://127.0.0.1:4317',
      '/readyz': 'http://127.0.0.1:4317',
    },
  },
})
