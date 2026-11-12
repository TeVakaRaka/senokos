// Настройка бота игры через Telegram Bot API. Токен берётся из .env.local
// (файл не в git) и никуда не печатается.
//
//   node tools/telegram-bot.mjs info            — проверить бота и показать кнопку меню
//   node tools/telegram-bot.mjs setup <https>   — кнопка «Играть» с адресом игры + описание

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function token() {
  const path = fileURLToPath(new URL('../.env.local', import.meta.url));
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error('Нет файла .env.local с TELEGRAM_BOT_TOKEN');
  }
  const match = text.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
  if (!match) throw new Error('В .env.local нет строки TELEGRAM_BOT_TOKEN=');
  return match[1].trim();
}

async function call(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description ?? res.status}`);
  return data.result;
}

const [command, url] = process.argv.slice(2);

if (command === 'info') {
  const me = await call('getMe');
  const button = await call('getChatMenuButton');
  console.log(`Бот: @${me.username} («${me.first_name}»), id ${me.id}`);
  console.log(`Кнопка меню: ${button.type === 'web_app' ? `«${button.text}» → ${button.web_app.url}` : button.type}`);
} else if (command === 'setup') {
  if (!url || !url.startsWith('https://')) {
    console.error('Нужен https-адрес игры: node tools/telegram-bot.mjs setup https://…');
    process.exit(1);
  }
  await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url } } });
  await call('setMyShortDescription', { short_description: 'Коси траву одним пальцем. Коса бьёт сама.' });
  await call('setMyDescription', {
    description:
      'Сенокос — короткая игра про летний луг. Веди косаря пальцем, коса бьёт сама. Нажми «Играть» внизу слева.',
  });
  await call('setMyCommands', { commands: [{ command: 'start', description: 'Начать' }] });
  const me = await call('getMe');
  console.log(`Готово: у @${me.username} кнопка «Играть» → ${url}`);
} else {
  console.log('Команды: info | setup <https-адрес>');
}
