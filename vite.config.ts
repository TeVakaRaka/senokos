import { defineConfig } from 'vitest/config';

// Игра — статический сайт: относительные пути, чтобы работать из любой папки хостинга.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173, strictPort: true },
  // Адреса временного туннеля Cloudflare (https для Telegram Mini App).
  preview: { port: 4173, strictPort: true, allowedHosts: ['.trycloudflare.com'] },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
