// Готовит эталон для страницы ?selftest: бот играет минуту на трёх зёрнах,
// хеши состояния пишутся в public/selftest.json. Телефон проигрывает то же самое
// и показывает, совпало ли — так одинаковость расчётов проверяется на реальном устройстве.
// Запускается сам перед dev и build.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { botInput, createBot } from '../src/sim/bot.ts';
import { createGame, step } from '../src/sim/game.ts';
import { hashGame, hashTuning, hex8 } from '../src/sim/hash.ts';
import { DEFAULT_TUNING } from '../src/sim/tuning.ts';

const TICKS = 1800;
const SEEDS = [1, 2, 3];

const runs = SEEDS.map((seed) => {
  const g = createGame(seed);
  const bot = createBot(seed);
  for (let i = 0; i < TICKS; i++) step(g, botInput(g, bot));
  return { seed, hash: hex8(hashGame(g)) };
});

const out = {
  ticks: TICKS,
  tuning: hex8(hashTuning(DEFAULT_TUNING)),
  engine: `node ${process.version}`,
  runs,
};

const dir = fileURLToPath(new URL('../public/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(fileURLToPath(new URL('../public/selftest.json', import.meta.url)), JSON.stringify(out, null, 2));
console.log(`selftest.json: ${runs.map((r) => `${r.seed}:${r.hash}`).join(' ')}`);
