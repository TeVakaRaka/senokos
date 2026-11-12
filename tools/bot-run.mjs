// Прогон бота для подбора баланса: полный день на N зёрнах.
// Запуск: npm run bot            (20 зёрен)
//         npm run bot -- 50      (50 зёрен)

import { botInput, createBot } from '../src/sim/bot.ts';
import { createGame, step } from '../src/sim/game.ts';
import { groundKg } from '../src/sim/hay.ts';
import { DT } from '../src/sim/tuning.ts';

const seeds = Number(process.argv[2] ?? 20);
const sum = { stacked: 0, perks: 0, ground: 0, mown: 0, mow: 0, haul: 0, walk: 0, idle: 0, firstPerk: 0 };

console.log('зерно  в стогу  перков  1-й перк  на земле  скошено  косит  носит  ходит  стоит');
for (let seed = 1; seed <= seeds; seed++) {
  const g = createGame(seed);
  const bot = createBot(seed);
  const time = { mow: 0, haul: 0, walk: 0, idle: 0 };
  let firstPerk = -1;
  let guard = 0;
  while (!g.over && guard++ < 200000) {
    const input = botInput(g, bot);
    const choosing = g.offer !== null;
    step(g, input);
    if (choosing) {
      if (firstPerk < 0) firstPerk = g.tick * DT;
      continue;
    }
    if (g.swing || g.needAhead > 0) time.mow++;
    else if (input === 0) time.idle++;
    else if (g.hero.load > 0) time.haul++;
    else time.walk++;
  }
  const ticks = g.tick;
  const pct = (v) => `${Math.round((v / ticks) * 100)}%`.padStart(5);
  const mown = g.cutTufts / g.field.count;
  sum.stacked += g.stacked;
  sum.perks += g.level;
  sum.ground += groundKg(g) + g.hero.load;
  sum.mown += mown;
  sum.firstPerk += Math.max(0, firstPerk);
  for (const k of ['mow', 'haul', 'walk', 'idle']) sum[k] += time[k] / ticks;
  console.log(
    `${String(seed).padStart(5)}  ${g.stacked.toFixed(0).padStart(4)} кг  ${String(g.level).padStart(6)}  ${firstPerk.toFixed(1).padStart(6)} с  ${(groundKg(g) + g.hero.load).toFixed(0).padStart(5)} кг  ${(mown * 100).toFixed(0).padStart(6)}%  ${pct(time.mow)}  ${pct(time.haul)}  ${pct(time.walk)}  ${pct(time.idle)}`,
  );
}
const avg = (v) => v / seeds;
console.log(
  `\nВ среднем: в стогу ${avg(sum.stacked).toFixed(0)} кг, перков ${avg(sum.perks).toFixed(1)}, первый перк на ${avg(sum.firstPerk).toFixed(1)} с, ` +
    `осталось на земле ${avg(sum.ground).toFixed(0)} кг, скошено ${(avg(sum.mown) * 100).toFixed(0)}% поля.`,
);
console.log(
  `Время: косит ${(avg(sum.mow) * 100).toFixed(0)}%, носит ${(avg(sum.haul) * 100).toFixed(0)}%, ходит ${(avg(sum.walk) * 100).toFixed(0)}%, стоит ${(avg(sum.idle) * 100).toFixed(0)}%.`,
);
