// Ядро симуляции: состояние забега и один шаг step(game, input).
// Никакого браузера, никаких часов: одинаковые зерно и ввод дают одинаковое состояние
// на любом устройстве.

import { cosDeg, sinDeg } from './dmath.ts';
import { DIR_COUNT, DIR_X, DIR_Y } from './dirs.ts';
import { cellCoord, standingWithin, type Field } from './field.ts';
import { generateLevel, STACK_RADIUS, type Rock } from './gen.ts';
import { dropPile, dryPiles, pickUp, unload, type PickEvent, type Pile } from './hay.ts';
import { applyChoice, checkLevel, CHOICE_BASE, derive, OFFER_SIZE, PERK_COUNT, type Derived } from './perks.ts';
import { Rng } from './rng.ts';
import { cloneTuning, DEFAULT_TUNING, DT, TICK_RATE, type Tuning } from './tuning.ts';

export type { Derived } from './perks.ts';

/** Ввод за шаг: 0 — палец не касается, 1…64 — направление (номер + 1), 65…67 — выбор перка. */
export const INPUT_NONE = 0;

export interface Hero {
  x: number;
  y: number;
  px: number; // позиция на прошлом шаге — картинка плавно ведёт героя между шагами
  py: number;
  dir: number; // куда смотрит: 0…63
  speed: number; // м/с
  swingCd: number; // шагов до следующего взмаха
  load: number; // кг в охапке
}

export interface SwingEvent {
  x: number;
  y: number;
  dir: number;
  reach: number;
  arcDeg: number;
  cut: number; // сколько кустиков срезано этим взмахом
  kg: number; // сколько сена срезано
}

export interface Game {
  seed: number;
  tuning: Tuning;
  tick: number; // шагов игрового времени (выбор перка время не двигает)
  dayTicks: number; // длина дня в шагах
  over: boolean; // день окончен
  rng: Rng;

  field: Field;
  stackX: number;
  stackY: number;
  rocks: Rock[];

  hero: Hero;
  d: Derived;

  piles: Pile[];
  nextPileId: number;
  stacked: number; // кг в стогу
  level: number; // сколько порогов пройдено
  perks: number[]; // уровни перков
  offer: number[] | null; // предложенные перки, пока игрок выбирает

  // Статистика
  swings: number;
  cutTufts: number;
  cutKg: number;

  // События последнего шага — по ним картинка и звук делают эффекты. В хеш не входят.
  swing: SwingEvent | null;
  cutIdx: Int32Array;
  cutCount: number;
  newPileIds: number[];
  readyIds: number[];
  picks: PickEvent[];
  unloadedKg: number;
  leveled: boolean;
  /** Сколько ударов ещё требует трава прямо по курсу (0 — травы впереди нет). */
  needAhead: number;
}

export function createGame(seed: number, tuning: Tuning = DEFAULT_TUNING): Game {
  const t = cloneTuning(tuning);
  const level = generateLevel(seed, t);
  const perks = new Array<number>(PERK_COUNT).fill(0);
  const g: Game = {
    seed,
    tuning: t,
    tick: 0,
    dayTicks: Math.max(1, Math.round(t.dayLength * TICK_RATE)),
    over: false,
    rng: new Rng((seed ^ 0x51ed270b) >>> 0),
    field: level.field,
    stackX: level.stackX,
    stackY: level.stackY,
    rocks: level.rocks,
    hero: {
      x: level.heroX,
      y: level.heroY,
      px: level.heroX,
      py: level.heroY,
      dir: 40, // лицом «вверх по экрану»
      speed: 0,
      swingCd: 0,
      load: 0,
    },
    d: derive(t, perks),
    piles: [],
    nextPileId: 1,
    stacked: 0,
    level: 0,
    perks,
    offer: null,
    swings: 0,
    cutTufts: 0,
    cutKg: 0,
    swing: null,
    cutIdx: new Int32Array(2048),
    cutCount: 0,
    newPileIds: [],
    readyIds: [],
    picks: [],
    unloadedKg: 0,
    leveled: false,
    needAhead: 0,
  };
  placeYesterdayHay(g);
  return g;
}

/**
 * «Вчерашнее» сено: готовые кучки дугой у стога по пути героя.
 * Первая выгрузка и первый перк — в первые секунды дня.
 */
function placeYesterdayHay(g: Game): void {
  const t = g.tuning;
  const n = Math.max(0, Math.round(t.yesterdayPiles));
  if (n === 0 || t.yesterdayKg <= 0) return;
  const kg = t.yesterdayKg / n;
  const r = STACK_RADIUS + 1.25;
  for (let i = 0; i < n; i++) {
    const angle = 70 + i * 40; // от героя (45°) вокруг стога
    g.piles.push({
      id: g.nextPileId++,
      x: g.stackX + cosDeg(angle) * r,
      y: g.stackY + sinDeg(angle) * r,
      mass: kg,
      dry: 1,
    });
  }
}

/** Один шаг симуляции (1/30 секунды) или выбор перка. */
export function step(g: Game, input: number): void {
  // События прошлого шага больше не нужны.
  g.swing = null;
  g.cutCount = 0;
  g.newPileIds.length = 0;
  g.readyIds.length = 0;
  g.picks.length = 0;
  g.unloadedKg = 0;
  g.leveled = false;

  if (g.over) return;

  // Пока игрок выбирает перк, время стоит; принимается только выбор.
  if (g.offer !== null) {
    const index = input - CHOICE_BASE;
    if (index >= 0 && index < OFFER_SIZE) applyChoice(g, index);
    return;
  }

  const h = g.hero;
  const t = g.tuning;
  const d = g.d;

  g.tick++;
  h.px = h.x;
  h.py = h.y;

  const moving = input >= 1 && input <= DIR_COUNT;
  if (moving) h.dir = input - 1;

  // 1. Сушка (на шаге 2 солнце всегда).
  dryPiles(g, 1);

  // 2. Коса: бьёт сама, как только готова и в секторе есть трава. С полной охапкой — на плече.
  if (h.swingCd > 0) h.swingCd--;
  const full = h.load >= d.carryCap;
  scythe(g, !full);

  // 3. Движение. Скорость — наименьшая из бега (с поправкой на груз и брод) и шага косаря.
  if (moving) {
    let target = t.runSpeed * (1 - (t.carrySlow * h.load) / d.carryCap);
    if (standingWithin(g.field, h.x, h.y, t.wadeRadius)) target *= t.wadeFactor;
    if (g.needAhead > 0) {
      const pace = d.mowSpeed / g.needAhead;
      if (pace < target) target = pace;
    }
    if (target < h.speed) {
      const slowed = h.speed - t.accel * 2 * DT;
      h.speed = slowed < target ? target : slowed;
    } else {
      const sped = h.speed + t.accel * DT;
      h.speed = sped > target ? target : sped;
    }
    move(g);
  } else {
    h.speed = 0;
  }

  // 4. Сбор готовых кучек и выгрузка в стог.
  pickUp(g);
  g.unloadedKg = unload(g);
  if (g.unloadedKg > 0) checkLevel(g);

  // 5. Конец дня.
  if (g.tick >= g.dayTicks) g.over = true;
}

/** Перемещение героя на шаг: края поля и препятствия. */
function move(g: Game): void {
  const h = g.hero;
  const t = g.tuning;
  let nx = h.x + DIR_X[h.dir]! * h.speed * DT;
  let ny = h.y + DIR_Y[h.dir]! * h.speed * DT;

  const lo = t.heroRadius;
  const hi = t.fieldSize - t.heroRadius;
  if (nx < lo) nx = lo;
  else if (nx > hi) nx = hi;
  if (ny < lo) ny = lo;
  else if (ny > hi) ny = hi;

  const stackKeep = STACK_RADIUS + t.heroRadius;
  let dx = nx - g.stackX;
  let dy = ny - g.stackY;
  let d2 = dx * dx + dy * dy;
  if (d2 < stackKeep * stackKeep) {
    const dist = Math.sqrt(d2);
    if (dist > 1e-6) {
      nx = g.stackX + (dx / dist) * stackKeep;
      ny = g.stackY + (dy / dist) * stackKeep;
    } else {
      nx = g.stackX + stackKeep;
    }
  }
  for (let i = 0; i < g.rocks.length; i++) {
    const rock = g.rocks[i]!;
    const keep = rock.r + t.heroRadius;
    dx = nx - rock.x;
    dy = ny - rock.y;
    d2 = dx * dx + dy * dy;
    if (d2 < keep * keep) {
      const dist = Math.sqrt(d2);
      if (dist > 1e-6) {
        nx = rock.x + (dx / dist) * keep;
        ny = rock.y + (dy / dist) * keep;
      } else {
        nx = rock.x + keep;
      }
    }
  }

  h.x = nx;
  h.y = ny;
}

/**
 * Обходит кустики в радиусе косы. Если коса готова и в секторе взмаха есть трава — бьёт,
 * а срезанное кладёт кучкой за спиной героя. Заодно считает, сколько ударов ещё требует
 * трава в узком секторе прямо по курсу: от этого зависит шаг косаря.
 */
function scythe(g: Game, enabled: boolean): void {
  if (!enabled) {
    g.needAhead = 0;
    return;
  }
  const h = g.hero;
  const d = g.d;
  const f = g.field;
  const fx = DIR_X[h.dir]!;
  const fy = DIR_Y[h.dir]!;
  const ready = h.swingCd === 0;
  let cut = 0;
  let hit = 0;
  let need = 0;
  let kg = 0;

  const c0 = cellCoord(f.cols, h.x - d.reach);
  const c1 = cellCoord(f.cols, h.x + d.reach);
  const r0 = cellCoord(f.cols, h.y - d.reach);
  const r1 = cellCoord(f.cols, h.y + d.reach);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const cell = cy * f.cols + cx;
      const end = f.cellStart[cell + 1]!;
      for (let k = f.cellStart[cell]!; k < end; k++) {
        const i = f.cellItems[k]!;
        let hp = f.hp[i]!;
        if (hp === 0) continue;
        const dx = f.x[i]! - h.x;
        const dy = f.y[i]! - h.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > d.reach2) continue;
        const dist = Math.sqrt(dist2);
        const dot = dx * fx + dy * fy;
        if (dot < d.arcCos * dist) continue; // вне сектора взмаха

        if (ready) {
          hit++;
          hp = hp > d.damage ? hp - d.damage : 0;
          f.hp[i] = hp;
          if (hp === 0) {
            f.standing--;
            cut++;
            kg += g.tuning.grassYield[f.type[i]!]!;
            if (g.cutCount < g.cutIdx.length) g.cutIdx[g.cutCount++] = i;
          }
        }
        if (hp > 0 && dot >= d.probeCos * dist) {
          const hits = Math.ceil(hp / d.damage);
          if (hits > need) need = hits;
        }
      }
    }
  }

  g.needAhead = need;
  if (ready && hit > 0) {
    h.swingCd = d.swingTicks;
    g.swings++;
    g.cutTufts += cut;
    g.cutKg += kg;
    g.swing = { x: h.x, y: h.y, dir: h.dir, reach: d.reach, arcDeg: d.arcDeg, cut, kg };
    if (kg > 0) {
      const back = g.tuning.pileBack;
      dropPile(g, kg, h.x - fx * back, h.y - fy * back);
    }
  }
}
