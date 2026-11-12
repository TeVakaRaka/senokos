// Точка входа для проверки «два движка»: бот играет полный день на 20 зёрнах,
// для каждого печатается хеш состояния. Файл собирается в один скрипт без импортов
// и запускается и в Node (V8), и в jsc (JavaScriptCore) — строки обязаны совпасть.

import { botInput, createBot } from '../src/sim/bot.ts';
import { createGame, step } from '../src/sim/game.ts';
import { hashGame, hex8 } from '../src/sim/hash.ts';

declare const print: ((line: string) => void) | undefined;
// У jsc нет console, зато есть print.
const out: (line: string) => void = typeof print === 'function' ? print : (line) => console.log(line);

const TICKS = 5400; // три минуты

for (let seed = 1; seed <= 20; seed++) {
  const g = createGame(seed);
  const bot = createBot(seed);
  for (let i = 0; i < TICKS; i++) step(g, botInput(g, bot));
  out(`${seed} ${hex8(hashGame(g))} ${g.cutTufts} ${g.swings}`);
}
