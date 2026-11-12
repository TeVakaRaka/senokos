// Запуск сервера для игры по сети на этом компьютере.
// npm run host              — сборка и сервер на порту 4173
// node tools/host.mjs --port=8080

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const arg = process.argv.find((a) => a.startsWith('--port='));
const port = arg ? Number(arg.slice(7)) : Number(process.env.PORT) || 4173;

if (!existsSync(fileURLToPath(new URL('../dist/index.html', import.meta.url)))) {
  console.error('Нет сборки игры (dist/index.html). Сначала: npm run build');
  process.exit(1);
}

try {
  const server = await startServer({ port });
  console.log('Сенокос — сервер для игры по сети (до 4 игроков)');
  console.log(`  на этом компьютере: http://localhost:${server.port}`);
  console.log(`  в том же Wi-Fi:     ${server.lan}`);
  console.log('Откройте адрес на каждом устройстве и нажмите «С друзьями». Остановить — Ctrl+C.');
} catch (error) {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`Порт ${port} занят. Остановите то, что на нём запущено (например, npm run preview), или задайте другой: --port=8080`);
  } else {
    console.error(error);
  }
  process.exit(1);
}
