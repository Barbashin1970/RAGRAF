import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

// ── Авто cache-bust на новой версии ───────────────────────────────────
// Контракт: после деплоя пользователь не должен видеть остатков прошлой
// сессии (старые фильтры, draft'ы, кэшированные ответы). При смене
// __BUILD_VERSION__ (проставляется в vite.config.ts) чистим localStorage
// и делаем мягкий reload — это эквивалент Ctrl+Shift+R, который не
// нужно нажимать руками.
//
// Тонкости:
//   • Первое посещение (нет storedVersion) — НЕ reload, просто сохраняем.
//     Иначе каждый новый пользователь упирался бы в лишний refresh.
//   • storedVersion отличается от __BUILD_VERSION__ — реальная новая
//     версия. Чистим всё (включая UX-настройки density / star — это
//     приемлемая цена за гарантированно чистый старт).
//   • После reload снова попадаем сюда; storedVersion = current → no-op.
const BUILD_VERSION_KEY = 'app_build_version'
const storedVersion = localStorage.getItem(BUILD_VERSION_KEY)
if (storedVersion !== __BUILD_VERSION__) {
  if (storedVersion !== null) {
    // Сохраняем флаг ДО clear() чтобы он пережил очистку.
    localStorage.clear()
    localStorage.setItem(BUILD_VERSION_KEY, __BUILD_VERSION__)
    // Soft reload — заодно react-query cache (in-memory) сбрасывается.
    // Hashed bundles меняются на новые автоматически, поэтому достаточно
    // обычного reload без cache-bust query string.
    window.location.reload()
    // eslint-disable-next-line no-throw-literal
    throw 'reloading'  // прекращаем рендер до перезагрузки
  } else {
    localStorage.setItem(BUILD_VERSION_KEY, __BUILD_VERSION__)
  }
}

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
