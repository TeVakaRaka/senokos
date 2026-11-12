// Точка входа для проверки «два движка»: бот играет полный день на 20 зёрнах,
// для каждого печатается хеш состояния. Файл собирается в один скрипт без импортов
// и запускается и в Node (V8), и в jsc (JavaScriptCore) — строки обязаны совпасть.

import { autoplay } from '../src/sim/autoplay.ts';
import { hashGame, hex8 } from '../src/sim/hash.ts';

declare const print: ((line: string) => void) | undefined;
// У jsc нет console, зато есть print.
const out: (line: string) => void = typeof print === 'function' ? print : (line) => console.log(line);

for (let seed = 1; seed <= 20; seed++) {
  const { game } = autoplay(seed);
  out(`${seed} ${hex8(hashGame(game))} ${Math.round(game.stacked)} ${game.level}`);
}
