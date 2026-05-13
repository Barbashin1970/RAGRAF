import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
