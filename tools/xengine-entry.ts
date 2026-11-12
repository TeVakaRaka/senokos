// Точка входа для проверки «два движка»: боты играют полный день на 20 зёрнах — сначала
// в одиночку, потом вдвоём друг против друга; для каждого забега печатается хеш состояния.
// Файл собирается в один скрипт без импортов и запускается и в Node (V8), и в jsc
// (JavaScriptCore) — строки обязаны совпасть.

import { autoplay } from '../src/sim/autoplay.ts';
import { hashGame, hex8 } from '../src/sim/hash.ts';
import { DEFAULT_TUNING } from '../src/sim/tuning.ts';

declare const print: ((line: string) => void) | undefined;
// У jsc нет console, зато есть print.
const out: (line: string) => void = typeof print === 'function' ? print : (line) => console.log(line);

// Строка: игроков, зерно, хеш, сено в стогах, улучшений (соло) или подрезанных ног (PvP).
for (let seed = 1; seed <= 20; seed++) {
  const { game } = autoplay(seed);
  const p = game.players[0]!;
  out(`1 ${seed} ${hex8(hashGame(game))} ${Math.round(p.stacked)} ${p.level}`);
}
for (let seed = 1; seed <= 20; seed++) {
  const { game } = autoplay(seed, Infinity, DEFAULT_TUNING, 2);
  const a = game.players[0]!;
  const b = game.players[1]!;
  out(`2 ${seed} ${hex8(hashGame(game))} ${Math.round(a.stacked)}:${Math.round(b.stacked)} ${a.hits + b.hits}`);
}
