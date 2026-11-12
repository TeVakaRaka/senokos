// Правила сена: покос лежит и сохнет на месте, грабли сгребают сухое в тюк,
// тюк выгружается в стог, перки, конец дня.

import { describe, expect, it } from 'vitest';
import { botInput, createBot } from '../src/sim/bot.ts';
import { createGame, step, type Game } from '../src/sim/game.ts';
import { dryKg, groundKg } from '../src/sim/hay.ts';
import {
  CHOICE_BASE,
  derive,
  levelThreshold,
  PERK_ARC,
  PERK_CARRY,
  PERK_COUNT,
  PERK_RAKE,
  PERK_RATE,
  PERK_REACH,
} from '../src/sim/perks.ts';
import { cloneTuning, DEFAULT_TUNING, DT, TICK_RATE, type Tuning } from '../src/sim/tuning.ts';

const EAST = 1; // направление 0: вдоль +x
const WEST = 33; // направление 32: вдоль −x

/** Сплошное поле без камней, голых пятен и вчерашнего сена. */
function tuning(patch: Partial<Tuning> = {}): Tuning {
  return { ...cloneTuning(DEFAULT_TUNING), fieldSize: 64, coverage: 1.5, rockCount: 0, yesterdayKg: 0, ...patch };
}

function run(g: Game, input: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(g, input);
}

/** Вся масса сена в игре: на земле, в тюке и в стогу. */
function totalKg(g: Game): number {
  return groundKg(g) + g.hero.load + g.stacked;
}

function placeHero(g: Game, x: number, y: number): void {
  g.hero.x = x;
  g.hero.y = y;
  g.hero.px = x;
  g.hero.py = y;
}

/** Увести героя из зоны выгрузки у стога (он стартует прямо в ней). */
function farFromStack(g: Game): void {
  placeHero(g, g.stackX + 9, g.stackY);
}

/** Положить на кустик сухое сено, будто его скосили давно. */
function layDryHay(g: Game, i: number, kg: number): void {
  const f = g.field;
  if (f.hp[i] !== 0) f.standing--;
  f.hp[i] = 0;
  f.hay[i] = kg;
  f.cutTick[i] = g.tick - g.dryTicks;
}

/** Ближайший к точке кустик на расстоянии от min до max. */
function tuftAtDistance(g: Game, x: number, y: number, min: number, max: number): number {
  const f = g.field;
  for (let i = 0; i < f.count; i++) {
    const d = Math.hypot(f.x[i]! - x, f.y[i]! - y);
    if (d >= min && d <= max) return i;
  }
  throw new Error('нет кустика на нужном расстоянии');
}

describe('покос лежит и сохнет на месте', () => {
  it('срезанное остаётся лежать там, где росло', () => {
    const g = createGame(7, tuning());
    farFromStack(g);
    run(g, EAST, 120);
    expect(g.cutTufts).toBeGreaterThan(50);
    const f = g.field;
    let lying = 0;
    for (let i = 0; i < f.count; i++) {
      if (f.hp[i] === 0) {
        expect(f.hay[i]).toBeCloseTo(g.tuning.grassYield[0], 12);
        lying++;
      } else {
        expect(f.hay[i]).toBe(0);
      }
    }
    expect(lying).toBe(g.cutTufts);
    expect(groundKg(g)).toBeCloseTo(g.cutKg, 9);
    expect(g.hero.load).toBe(0);
  });

  it('масса сена сохраняется: скошено + вчерашнее = земля + тюк + стог', () => {
    const g = createGame(3);
    const start = totalKg(g);
    expect(start).toBeGreaterThanOrEqual(g.tuning.yesterdayKg);
    expect(start).toBeLessThan(g.tuning.yesterdayKg + 1);
    const bot = createBot(3);
    for (let i = 0; i < 4000; i++) step(g, botInput(g, bot));
    expect(g.stacked).toBeGreaterThan(10);
    expect(totalKg(g)).toBeCloseTo(start + g.cutKg, 6);
  });

  it('сырое сено грабли не берут, сухое — берут', () => {
    const g = createGame(7, tuning());
    farFromStack(g);
    run(g, EAST, 90); // прокосил полосу
    run(g, WEST, 40); // сразу назад по своей полосе: сено ещё сырое
    expect(g.hero.load).toBe(0);
    expect(dryKg(g)).toBe(0);
    run(g, 0, g.dryTicks); // подождал, пока высохнет
    expect(dryKg(g)).toBeGreaterThan(1);
    run(g, EAST, 40); // прошёл по сухому
    expect(g.hero.load).toBeGreaterThan(1);
  });

  it('высыхает ровно через время сушки', () => {
    const g = createGame(7, tuning());
    farFromStack(g);
    run(g, EAST, 40);
    const i = g.cutIdx[0] ?? -1;
    const cutAt = g.field.cutTick.find((t, k) => g.field.hp[k] === 0 && t > 0)!;
    expect(i).toBeGreaterThanOrEqual(-1);
    const wait = cutAt + g.dryTicks - g.tick;
    run(g, 0, wait - 1);
    const before = dryKg(g);
    run(g, 0, 1);
    expect(dryKg(g)).toBeGreaterThan(before);
    expect(g.dryTicks).toBe(Math.round(g.tuning.dryTime * TICK_RATE));
  });
});

describe('грабли и тюк', () => {
  it('гребут только в своём радиусе', () => {
    const g = createGame(7, tuning());
    farFromStack(g);
    const r = g.d.rakeRadius;
    const near = tuftAtDistance(g, g.hero.x, g.hero.y, 0, r - 0.2);
    const far = tuftAtDistance(g, g.hero.x, g.hero.y, r + 0.3, r + 1.2);
    layDryHay(g, near, 0.1);
    layDryHay(g, far, 0.1);
    step(g, 0);
    expect(g.field.hay[near]).toBe(0);
    expect(g.field.hay[far]).toBeCloseTo(0.1, 12);
    expect(g.hero.load).toBeCloseTo(0.1, 12);
    expect(g.rakeCount).toBe(1);
    expect(g.rakeIdx[0]).toBe(near);
  });

  it('тюк не переполняется: лишнее остаётся лежать', () => {
    const g = createGame(7, tuning());
    farFromStack(g);
    const cap = g.d.carryCap;
    const tuft = tuftAtDistance(g, g.hero.x, g.hero.y, 0, 0.5);
    layDryHay(g, tuft, 2);
    g.hero.load = cap - 0.5;
    step(g, 0);
    expect(g.hero.load).toBe(cap);
    expect(g.field.hay[tuft]).toBeCloseTo(1.5, 9);
    expect(g.rakeCount).toBe(0); // кустик сгребён не начисто
  });

  it('с полным тюком коса не машет и грабли не гребут', () => {
    const g = createGame(7, tuning());
    farFromStack(g);
    g.hero.load = g.d.carryCap;
    const tuft = tuftAtDistance(g, g.hero.x, g.hero.y, 0, 0.5);
    layDryHay(g, tuft, 0.1);
    run(g, EAST, 200);
    expect(g.swings).toBe(0);
    expect(g.needAhead).toBe(0);
    expect(g.field.hay[tuft]).toBeCloseTo(0.1, 12);
  });

  it('груз замедляет героя', () => {
    const empty = createGame(7, tuning({ coverage: 0 }));
    const loaded = createGame(7, tuning({ coverage: 0 }));
    farFromStack(empty);
    farFromStack(loaded);
    loaded.hero.load = loaded.d.carryCap;
    run(empty, EAST, 30);
    run(loaded, EAST, 30);
    expect(empty.hero.speed).toBeCloseTo(empty.tuning.runSpeed, 6);
    expect(loaded.hero.speed).toBeCloseTo(loaded.tuning.runSpeed * (1 - loaded.tuning.carrySlow), 6);
  });
});

describe('стог', () => {
  it('у стога тюк выгружается в стог целиком', () => {
    const g = createGame(7, tuning());
    placeHero(g, g.stackX + 2, g.stackY);
    g.hero.load = 6; // меньше порога первого перка — выгрузка не прервётся выбором
    run(g, 0, 30);
    expect(g.hero.load).toBe(0);
    expect(g.stacked).toBeCloseTo(6, 9);
  });

  it('вдали от стога тюк не выгружается', () => {
    const g = createGame(7, tuning());
    placeHero(g, g.stackX + 8, g.stackY);
    g.hero.load = 10;
    run(g, 0, 30);
    expect(g.hero.load).toBe(10);
    expect(g.stacked).toBe(0);
  });

  it('вчерашний покос лежит сухим рядом с героем и даёт первый перк в первые секунды', () => {
    const g = createGame(7);
    expect(dryKg(g)).toBeGreaterThanOrEqual(g.tuning.yesterdayKg);
    expect(g.cutTufts).toBe(0); // вчерашнее в сегодняшний покос не считается
    const bot = createBot(7);
    let ticks = 0;
    while (g.offer === null && ticks < 600) {
      step(g, botInput(g, bot));
      ticks++;
    }
    expect(g.offer).not.toBeNull();
    expect(ticks * DT).toBeLessThan(10);
  });
});

describe('перки', () => {
  function withOffer(): Game {
    const g = createGame(7, tuning());
    placeHero(g, g.stackX + 2, g.stackY);
    g.hero.load = levelThreshold(g.tuning, 0) + 0.5;
    run(g, 0, 30);
    expect(g.offer).not.toBeNull();
    return g;
  }

  it('на пороге предлагаются три разных перка', () => {
    const g = withOffer();
    expect(g.offer!.length).toBe(3);
    expect(new Set(g.offer!).size).toBe(3);
    for (const p of g.offer!) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(PERK_COUNT);
    }
  });

  it('пока игрок выбирает, время стоит', () => {
    const g = withOffer();
    const tick = g.tick;
    run(g, EAST, 50);
    expect(g.tick).toBe(tick);
    expect(g.offer).not.toBeNull();
  });

  it('выбор применяет ровно свой перк', () => {
    const g = withOffer();
    const chosen = g.offer![1]!;
    step(g, CHOICE_BASE + 1);
    expect(g.offer).toBeNull();
    expect(g.level).toBe(1);
    for (let p = 0; p < PERK_COUNT; p++) expect(g.perks[p]).toBe(p === chosen ? 1 : 0);
  });

  it('каждый перк меняет только свои числа', () => {
    const t = cloneTuning(DEFAULT_TUNING);
    const none = new Array<number>(PERK_COUNT).fill(0);
    const base = derive(t, none);
    const one = (perk: number) => derive(t, none.map((_, p) => (p === perk ? 1 : 0)));

    const arc = one(PERK_ARC);
    expect(arc.arcDeg).toBe(base.arcDeg + t.arcPerLevel);
    expect(arc.reach).toBe(base.reach);
    expect(arc.carryCap).toBe(base.carryCap);
    expect(arc.rakeRadius).toBe(base.rakeRadius);

    const reach = one(PERK_REACH);
    expect(reach.reach).toBeCloseTo(base.reach + t.reachPerLevel, 12);
    expect(reach.mowSpeed).toBeGreaterThan(base.mowSpeed);
    expect(reach.arcDeg).toBe(base.arcDeg);

    const rate = one(PERK_RATE);
    expect(rate.swingTicks).toBe(Math.round(t.swingPeriod * (1 - t.ratePerLevel) * TICK_RATE));
    expect(rate.reach).toBe(base.reach);

    const carry = one(PERK_CARRY);
    expect(carry.carryCap).toBe(base.carryCap + t.carryPerLevel);
    expect(carry.swingTicks).toBe(base.swingTicks);

    const wide = one(PERK_RAKE);
    expect(wide.rakeRadius).toBeCloseTo(base.rakeRadius + t.rakePerLevel, 12);
    expect(wide.carryCap).toBe(base.carryCap);
    expect(wide.reach).toBe(base.reach);
  });

  it('перки на максимуме больше не предлагаются', () => {
    const g = withOffer();
    g.perks[PERK_ARC] = g.tuning.perkMaxLevel;
    g.perks[PERK_REACH] = g.tuning.perkMaxLevel;
    step(g, CHOICE_BASE); // взять что-то из текущего предложения
    g.hero.load = 200;
    run(g, 0, 40);
    expect(g.offer).not.toBeNull();
    for (const p of g.offer!) expect(p === PERK_ARC || p === PERK_REACH).toBe(false);
  });

  it('пороги после списка продолжают расти', () => {
    const t = cloneTuning(DEFAULT_TUNING);
    const n = t.levelKg.length;
    const a = levelThreshold(t, n - 1);
    const b = levelThreshold(t, n);
    const c = levelThreshold(t, n + 1);
    expect(b).toBeGreaterThan(a);
    expect(c - b).toBeGreaterThan(b - a);
  });
});

describe('конец дня', () => {
  it('день кончается в срок, после этого ничего не меняется', () => {
    const g = createGame(7, tuning({ dayLength: 2 }));
    farFromStack(g);
    run(g, EAST, 60);
    expect(g.over).toBe(true);
    expect(g.tick).toBe(60);
    const x = g.hero.x;
    run(g, EAST, 30);
    expect(g.tick).toBe(60);
    expect(g.hero.x).toBe(x);
  });
});
