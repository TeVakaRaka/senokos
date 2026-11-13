// Точка входа для проверки «два движка»: боты играют полный день на 20 зёрнах — сначала
// в одиночку, потом вдвоём друг против друга, потом вчетвером (на всех локациях); для каждого забега печатается хеш состояния.
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
// Вчетвером: луг, огороды и река (локацию выбирает зерно), ружьё, собаки.
for (let seed = 1; seed <= 6; seed++) {
  const { game } = autoplay(seed, Infinity, DEFAULT_TUNING, 4);
  const kg = game.players.map((p) => Math.round(p.stacked)).join(':');
  const hits = game.players.reduce((n, p) => n + p.hits + p.shotHits, 0);
  out(`4 ${seed} ${hex8(hashGame(game))} ${kg} ${hits}`);
}
// Вчетвером командами 2×2: общий стог, свои не бьют своих.
for (let seed = 1; seed <= 4; seed++) {
  const { game } = autoplay(seed, Infinity, DEFAULT_TUNING, 4, true);
  const kg = game.players.map((p) => Math.round(p.stacked)).join(':');
  const hits = game.players.reduce((n, p) => n + p.hits + p.shotHits, 0);
  out(`8 ${seed} ${hex8(hashGame(game))} ${kg} ${hits}`);
}
