// Прогон ботов для подбора баланса: полный день на N зёрнах.
// Запуск: npm run bot              (один косарь, 20 зёрен)
//         npm run bot -- 50        (50 зёрен)
//         npm run bot -- 20 pvp    (два бота друг против друга)

import { botInput, createBot } from '../src/sim/bot.ts';
import { createGame, step, TOOL_RAKE } from '../src/sim/game.ts';
import { dropsKg, groundKg } from '../src/sim/hay.ts';
import { DT } from '../src/sim/tuning.ts';

const seeds = Number(process.argv[2] ?? 20);
const pvp = process.argv[3] === 'pvp';
const count = pvp ? 2 : 1;
const avg = (v) => v / seeds;
const pad = (v, n) => String(v).padStart(n);

function play(seed) {
  const g = createGame(seed, undefined, count);
  const bots = g.players.map((p) => createBot(seed, p.id));
  const time = g.players.map(() => ({ mow: 0, rake: 0, haul: 0, walk: 0, idle: 0, crawl: 0 }));
  let firstPerk = -1;
  let guard = 0;
  const inputs = new Array(count).fill(0);
  while (!g.over && guard++ < 400000) {
    for (let i = 0; i < count; i++) inputs[i] = botInput(g, bots[i]);
    const before = g.tick;
    step(g, inputs);
    if (g.tick === before) {
      if (firstPerk < 0) firstPerk = g.tick * DT;
      continue; // шаг ушёл на выбор улучшения
    }
    for (let i = 0; i < count; i++) {
      const p = g.players[i];
      const t = time[i];
      if (p.crawl > 0) t.crawl++;
      else if (p.swing || p.needAhead > 0) t.mow++;
      else if (p.rakedKg > 0 || p.stolenKg > 0) t.rake++;
      else if ((inputs[i] & 127) === 0) t.idle++;
      else if (p.load > 0 && p.tool === TOOL_RAKE) t.haul++;
      else t.walk++;
    }
  }
  return { g, time, firstPerk };
}

const pct = (v, ticks) => `${Math.round((v / ticks) * 100)}%`.padStart(5);

if (!pvp) {
  const sum = { stacked: 0, perks: 0, ground: 0, mown: 0, firstPerk: 0, mow: 0, rake: 0, haul: 0, walk: 0, idle: 0 };
  console.log('зерно  в стогу  улучш.  1-е улучш.  на земле  скошено  косит  гребёт  везёт  ходит  стоит');
  for (let seed = 1; seed <= seeds; seed++) {
    const { g, time, firstPerk } = play(seed);
    const p = g.players[0];
    const t = time[0];
    const left = groundKg(g) + p.load;
    const mown = p.cutTufts / g.field.count;
    sum.stacked += p.stacked;
    sum.perks += p.level;
    sum.ground += left;
    sum.mown += mown;
    sum.firstPerk += Math.max(0, firstPerk);
    for (const k of ['mow', 'rake', 'haul', 'walk', 'idle']) sum[k] += t[k] / g.tick;
    console.log(
      `${pad(seed, 5)}  ${pad(p.stacked.toFixed(0), 4)} кг  ${pad(p.level, 6)}  ${pad(firstPerk.toFixed(1), 8)} с  ${pad(left.toFixed(0), 5)} кг  ${pad((mown * 100).toFixed(0), 6)}%  ${pct(t.mow, g.tick)}  ${pct(t.rake, g.tick)}  ${pct(t.haul, g.tick)}  ${pct(t.walk, g.tick)}  ${pct(t.idle, g.tick)}`,
    );
  }
  console.log(
    `\nВ среднем: в стогу ${avg(sum.stacked).toFixed(0)} кг, улучшений ${avg(sum.perks).toFixed(1)}, первое на ${avg(sum.firstPerk).toFixed(1)} с, ` +
      `осталось на земле ${avg(sum.ground).toFixed(0)} кг, скошено ${(avg(sum.mown) * 100).toFixed(0)}% поля.`,
  );
  console.log(
    `Время: косит ${(avg(sum.mow) * 100).toFixed(0)}%, гребёт ${(avg(sum.rake) * 100).toFixed(0)}%, везёт ${(avg(sum.haul) * 100).toFixed(0)}%, ` +
      `ходит ${(avg(sum.walk) * 100).toFixed(0)}%, стоит ${(avg(sum.idle) * 100).toFixed(0)}%.`,
  );
} else {
  const sum = { a: 0, b: 0, hitsA: 0, hitsB: 0, stolenA: 0, stolenB: 0, winA: 0, winB: 0, draw: 0, crawl: 0, perks: 0 };
  console.log('зерно  стог А  стог Б  подрезал А/Б  украл А/Б   улучш. А/Б  ползал А/Б  на земле  победил');
  for (let seed = 1; seed <= seeds; seed++) {
    const { g, time } = play(seed);
    const [a, b] = g.players;
    const left = groundKg(g) + dropsKg(g) + a.load + b.load;
    const winner = Math.abs(a.stacked - b.stacked) < 0.5 ? 'ничья' : a.stacked > b.stacked ? 'А' : 'Б';
    sum.a += a.stacked;
    sum.b += b.stacked;
    sum.hitsA += a.hits;
    sum.hitsB += b.hits;
    sum.stolenA += a.stolen;
    sum.stolenB += b.stolen;
    sum.perks += (a.level + b.level) / 2;
    sum.crawl += (time[0].crawl + time[1].crawl) / 2 / g.tick;
    if (winner === 'А') sum.winA++;
    else if (winner === 'Б') sum.winB++;
    else sum.draw++;
    console.log(
      `${pad(seed, 5)}  ${pad(a.stacked.toFixed(0), 4)} кг  ${pad(b.stacked.toFixed(0), 4)} кг  ${pad(`${a.hits}/${b.hits}`, 12)}  ${pad(`${a.stolen.toFixed(0)}/${b.stolen.toFixed(0)}`, 9)} кг  ${pad(`${a.level}/${b.level}`, 10)}  ${pad(`${pct(time[0].crawl, g.tick).trim()}/${pct(time[1].crawl, g.tick).trim()}`, 10)}  ${pad(left.toFixed(0), 5)} кг  ${winner}`,
    );
  }
  console.log(
    `\nВ среднем: стог А ${avg(sum.a).toFixed(0)} кг, стог Б ${avg(sum.b).toFixed(0)} кг; подрезаний за день ${avg(sum.hitsA + sum.hitsB).toFixed(1)}; ` +
      `украдено ${avg(sum.stolenA + sum.stolenB).toFixed(0)} кг; улучшений ${avg(sum.perks).toFixed(1)}; ползком ${(avg(sum.crawl) * 100).toFixed(0)}% времени.`,
  );
  console.log(`Победы: А ${sum.winA}, Б ${sum.winB}, ничьих ${sum.draw}.`);
}
