// Прогон бота для подбора баланса: полный день на N зёрнах.
// Запуск: npm run bot            (20 зёрен)
//         npm run bot -- 50      (50 зёрен)

import { botInput, createBot } from '../src/sim/bot.ts';
import { createGame, step } from '../src/sim/game.ts';
import { DT } from '../src/sim/tuning.ts';

const seeds = Number(process.argv[2] ?? 20);
const TICKS = 5400;

let sumCut = 0;
let sumShare = 0;
let sumMow = 0;
console.log('зерно  кустиков  скошено  доля поля  взмахов  косит  бежит  стоит');
for (let seed = 1; seed <= seeds; seed++) {
  const g = createGame(seed);
  const bot = createBot(seed);
  let mow = 0;
  let runTicks = 0;
  let idle = 0;
  for (let i = 0; i < TICKS; i++) {
    const input = botInput(g, bot);
    step(g, input);
    if (input === 0) idle++;
    else if (g.needAhead > 0) mow++;
    else runTicks++;
  }
  const share = g.cutTufts / g.field.count;
  sumCut += g.cutKg;
  sumShare += share;
  sumMow += mow / TICKS;
  const pct = (v) => `${Math.round((v / TICKS) * 100)}%`.padStart(5);
  console.log(
    `${String(seed).padStart(5)}  ${String(g.field.count).padStart(8)}  ${g.cutKg.toFixed(0).padStart(5)} кг  ${(share * 100).toFixed(0).padStart(8)}%  ${String(g.swings).padStart(7)}  ${pct(mow)}  ${pct(runTicks)}  ${pct(idle)}`,
  );
}
console.log(
  `\nВ среднем за день (${(TICKS * DT).toFixed(0)} с): скошено ${(sumCut / seeds).toFixed(0)} кг, ${((sumShare / seeds) * 100).toFixed(0)}% поля, косит ${((sumMow / seeds) * 100).toFixed(0)}% времени.`,
);
