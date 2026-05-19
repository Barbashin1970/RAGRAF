import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { execSync } from 'node:child_process'

// Версия сборки — пробрасывается в бандл через define, чтобы фронт мог
// сравнить с сохранённым в localStorage и принудительно сбросить кэш
// (см. main.tsx и принцип «после деплоя — нет прошлых сессий»).
//
// Приоритет источников:
//   1) Явный env VITE_BUILD_VERSION (CI / Railway может проставить).
//   2) Короткий git SHA если репо доступно при билде.
//   3) Timestamp билда как последний fallback (всегда уникален).
function resolveBuildVersion(): string {
  if (process.env.VITE_BUILD_VERSION) return process.env.VITE_BUILD_VERSION
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return `t-${Date.now()}`
  }
}
const BUILD_VERSION = resolveBuildVersion()

export default defineConfig({
  plugins: [react()],
  define: {
    // Доступно в коде как `__BUILD_VERSION__` (см. global.d.ts).
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Поднимаем порог чтобы Vite не ругался — основной чанк ниже 500kB
    // после splitting, но vendor-чанки крупных библиотек (cytoscape, reactflow)
    // выйдут за порог. Это OK — они lazy-loaded и кэшируются браузером
    // после первого захода.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Разделяем bundle на логические чанки чтобы:
        //   1) Initial load был минимальным (~150-200kB вместо 1.4MB) —
        //      пользователь видит landing/список регламентов мгновенно.
        //   2) Тяжёлые libs (reactflow, cytoscape) лоадились ТОЛЬКО при
        //      входе в редактор потока / граф связей.
        //   3) Vendor-чанки кэшировались между деплоями — изменение app-кода
        //      не инвалидирует кэш react/react-dom/lucide.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'flow-vendor': ['reactflow'],
          'cytoscape-vendor': ['cytoscape', 'cytoscape-cola'],
          'dnd-vendor': ['@dnd-kit/core', '@dnd-kit/sortable'],
          'icons-vendor': ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    proxy: {
      '/api':          process.env.VITE_API_PROXY || 'http://localhost:8000',
      // FastAPI auto-generated Swagger UI, ReDoc и OpenAPI spec — пробрасываем,
      // чтобы кнопка «Docs» в шапке открывала их с того же origin.
      '/docs':         process.env.VITE_API_PROXY || 'http://localhost:8000',
      '/redoc':        process.env.VITE_API_PROXY || 'http://localhost:8000',
      '/openapi.json': process.env.VITE_API_PROXY || 'http://localhost:8000',
    },
  },
})
