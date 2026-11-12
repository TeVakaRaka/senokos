// Готовит эталон для страницы ?selftest: боты играют минуту на трёх зёрнах (в одиночку и вдвоём),
// хеши состояния пишутся в public/selftest.json. Телефон проигрывает то же самое
// и показывает, совпало ли — так одинаковость расчётов проверяется на реальном устройстве.
// Запускается сам перед build.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { autoplay } from '../src/sim/autoplay.ts';
import { hashGame, hashTuning, hex8 } from '../src/sim/hash.ts';
import { DEFAULT_TUNING } from '../src/sim/tuning.ts';

const TICKS = 1800;
const SEEDS = [1, 2, 3];

// Каждое зерно — дважды: бот в одиночку и два бота друг против друга.
const runs = [];
for (const players of [1, 2]) {
  for (const seed of SEEDS) {
    const { game } = autoplay(seed, TICKS, DEFAULT_TUNING, players);
    runs.push({ seed, players, hash: hex8(hashGame(game)) });
  }
}

const out = {
  ticks: TICKS,
  tuning: hex8(hashTuning(DEFAULT_TUNING)),
  engine: `node ${process.version}`,
  runs,
};

mkdirSync(fileURLToPath(new URL('../public/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('../public/selftest.json', import.meta.url)), JSON.stringify(out, null, 2));
console.log(`selftest.json: ${runs.map((r) => `${r.players}/${r.seed}:${r.hash}`).join(' ')}`);
