// Правила шага 2: кучки, сушка, сбор, охапка, стог, перки, конец дня.

import { describe, expect, it } from 'vitest';
import { createGame, step, type Game } from '../src/sim/game.ts';
import { groundKg, type Pile } from '../src/sim/hay.ts';
import {
  CHOICE_BASE,
  derive,
  levelThreshold,
  PERK_ARC,
  PERK_CARRY,
  PERK_COUNT,
  PERK_RATE,
  PERK_REACH,
} from '../src/sim/perks.ts';
import { cloneTuning, DEFAULT_TUNING, DT, TICK_RATE, type Tuning } from '../src/sim/tuning.ts';

const EAST = 1; // направление 0: вдоль +x

function tuning(patch: Partial<Tuning> = {}): Tuning {
  return { ...cloneTuning(DEFAULT_TUNING), fieldSize: 64, coverage: 1.5, rockCount: 0, ...patch };
}

function run(g: Game, input: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(g, input);
}

/** Вся масса сена в игре: на земле, в охапке и в стогу. */
function totalKg(g: Game): number {
  return groundKg(g) + g.hero.load + g.stacked;
}

/** Убрать «вчерашнее» сено, чтобы проверять только своё. */
function noYesterday(patch: Partial<Tuning> = {}): Tuning {
  return tuning({ yesterdayKg: 0, ...patch });
}

/** Поставить героя в точку. */
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

describe('кучки и сушка', () => {
  it('каждый взмах кладёт срезанное кучкой за спиной героя', () => {
    const g = createGame(7, noYesterday());
    run(g, EAST, 120);
    expect(g.swings).toBeGreaterThan(3);
    expect(g.piles.length).toBeGreaterThan(0);
    // Кучки лежат позади героя (он идёт вдоль +x).
    for (const p of g.piles) expect(p.x).toBeLessThan(g.hero.x);
    expect(groundKg(g)).toBeCloseTo(g.cutKg, 9);
  });

  it('масса сена сохраняется: скошено + вчерашнее = земля + охапка + стог', () => {
    const g = createGame(3);
    const start = totalKg(g);
    expect(start).toBeCloseTo(g.tuning.yesterdayKg, 9);
    for (let i = 0; i < 3000; i++) step(g, ((i >> 7) % 64) + 1);
    expect(totalKg(g)).toBeCloseTo(start + g.cutKg, 6);
  });

  it('кучка становится готовой ровно через время сушки', () => {
    const g = createGame(7, noYesterday());
    run(g, EAST, 40);
    const pile = g.piles[0]!;
    expect(pile.dry).toBeLessThan(1);
    const dryTicks = Math.ceil((1 - pile.dry) * g.tuning.dryTime * TICK_RATE);
    let readyAt = -1;
    for (let i = 1; i <= dryTicks + 2; i++) {
      step(g, 0);
      if (g.readyIds.includes(pile.id)) readyAt = i;
    }
    expect(readyAt).toBeGreaterThanOrEqual(dryTicks - 1);
    expect(readyAt).toBeLessThanOrEqual(dryTicks + 1);
    expect(pile.dry).toBe(1);
  });

  it('сырая кучка не подбирается, готовая — подбирается', () => {
    const g = createGame(7, noYesterday());
    farFromStack(g);
    run(g, EAST, 40);
    const pile = g.piles[0]!;
    placeHero(g, pile.x, pile.y);
    step(g, 0);
    expect(g.hero.load).toBe(0);
    run(g, 0, g.tuning.dryTime * TICK_RATE + 2);
    expect(g.hero.load).toBeGreaterThan(0);
    expect(g.piles.find((p) => p.id === pile.id)).toBeUndefined();
  });
});

describe('охапка', () => {
  it('забирает из кучки ровно столько, сколько влезает', () => {
    const g = createGame(7, noYesterday());
    const cap = g.d.carryCap;
    const pile: Pile = { id: 999, x: 10, y: 10, mass: 2, dry: 1 };
    g.piles.push(pile);
    placeHero(g, 10, 10);
    g.hero.load = cap - 0.5;
    step(g, 0);
    expect(g.hero.load).toBe(cap);
    expect(pile.mass).toBeCloseTo(1.5, 9);
    expect(g.piles).toContain(pile);
  });

  it('с полной охапкой коса не машет и не замедляет', () => {
    const g = createGame(7, noYesterday());
    farFromStack(g);
    g.hero.load = g.d.carryCap;
    run(g, EAST, 200);
    expect(g.swings).toBe(0);
    expect(g.needAhead).toBe(0);
  });

  it('груз замедляет героя', () => {
    const empty = createGame(7, noYesterday({ coverage: 0 }));
    const loaded = createGame(7, noYesterday({ coverage: 0 }));
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
  it('у стога охапка выгружается в стог целиком', () => {
    const g = createGame(7, noYesterday());
    placeHero(g, g.stackX + 2, g.stackY);
    g.hero.load = 6; // меньше порога первого перка — выгрузка не прервётся выбором
    run(g, 0, 30);
    expect(g.hero.load).toBe(0);
    expect(g.stacked).toBeCloseTo(6, 9);
  });

  it('вдали от стога охапка не выгружается', () => {
    const g = createGame(7, noYesterday());
    placeHero(g, g.stackX + 8, g.stackY);
    g.hero.load = 10;
    run(g, 0, 30);
    expect(g.hero.load).toBe(10);
    expect(g.stacked).toBe(0);
  });

  it('вчерашнее сено даёт первый перк в первые секунды', () => {
    const g = createGame(7);
    let ticks = 0;
    // Обходит стог по кругу против часовой стрелки — там лежат вчерашние кучки.
    while (g.offer === null && ticks < 300) {
      const dx = g.hero.x - g.stackX;
      const dy = g.hero.y - g.stackY;
      // Касательная к окружности вокруг стога (поворот радиус-вектора на 90°).
      const angle = Math.atan2(dx, -dy);
      const dir = ((Math.round((angle / (2 * Math.PI)) * 64) % 64) + 64) % 64;
      step(g, dir + 1);
      ticks++;
    }
    expect(g.offer).not.toBeNull();
    expect(ticks * DT).toBeLessThan(6);
  });
});

describe('перки', () => {
  function withOffer(): Game {
    const g = createGame(7, noYesterday());
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
    for (const p of g.offer!) expect(p).toBeGreaterThanOrEqual(0);
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
    const base = derive(t, [0, 0, 0, 0]);
    const one = (perk: number) => derive(t, [0, 1, 2, 3].map((p) => (p === perk ? 1 : 0)));

    const arc = one(PERK_ARC);
    expect(arc.arcDeg).toBe(base.arcDeg + t.arcPerLevel);
    expect(arc.reach).toBe(base.reach);
    expect(arc.carryCap).toBe(base.carryCap);

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
  });

  it('перки на максимуме больше не предлагаются', () => {
    const g = withOffer();
    g.perks[PERK_ARC] = g.tuning.perkMaxLevel;
    g.perks[PERK_REACH] = g.tuning.perkMaxLevel;
    step(g, CHOICE_BASE); // взять что-то из текущего предложения
    g.hero.load = 200;
    run(g, 0, 40);
    if (g.offer) for (const p of g.offer) {
      expect(p === PERK_ARC || p === PERK_REACH).toBe(false);
    }
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
    const g = createGame(7, noYesterday({ dayLength: 2 }));
    run(g, EAST, 60);
    expect(g.over).toBe(true);
    expect(g.tick).toBe(60);
    const x = g.hero.x;
    run(g, EAST, 30);
    expect(g.tick).toBe(60);
    expect(g.hero.x).toBe(x);
  });
});
