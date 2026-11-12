// Готовит эталон для страницы ?selftest: бот играет минуту на трёх зёрнах,
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

const runs = SEEDS.map((seed) => ({ seed, hash: hex8(hashGame(autoplay(seed, TICKS).game)) }));

const out = {
  ticks: TICKS,
  tuning: hex8(hashTuning(DEFAULT_TUNING)),
  engine: `node ${process.version}`,
  runs,
};

mkdirSync(fileURLToPath(new URL('../public/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('../public/selftest.json', import.meta.url)), JSON.stringify(out, null, 2));
console.log(`selftest.json: ${runs.map((r) => `${r.seed}:${r.hash}`).join(' ')}`);
