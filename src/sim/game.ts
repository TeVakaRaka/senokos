// Ядро симуляции: состояние забега и один шаг step(game, input).
// Никакого браузера, никаких часов: одинаковые зерно и ввод дают одинаковое состояние
// на любом устройстве.

import { cosDeg } from './dmath.ts';
import { DIR_COUNT, DIR_X, DIR_Y } from './dirs.ts';
import { cellCoord, standingWithin, type Field } from './field.ts';
import { generateLevel, STACK_RADIUS, type Rock } from './gen.ts';
import { Rng } from './rng.ts';
import { cloneTuning, DEFAULT_TUNING, DT, TICK_RATE, type Tuning } from './tuning.ts';

/** Ввод за шаг: 0 — палец не касается, 1…64 — направление (номер + 1). */
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

/** Числа, выведенные из набора баланса и уровней перков. */
export interface Derived {
  reach: number;
  reach2: number;
  arcDeg: number;
  arcCos: number; // косинус половины дуги взмаха
  probeCos: number; // косинус половины узкого сектора «прямо по курсу»
  swingTicks: number;
  damage: number;
  mowSpeed: number; // шаг косаря, м/с
  wadeSpeed: number;
}

export interface SwingEvent {
  x: number;
  y: number;
  dir: number;
  reach: number;
  arcDeg: number;
  cut: number; // сколько кустиков срезано этим взмахом
}

export interface Game {
  seed: number;
  tuning: Tuning;
  tick: number;
  rng: Rng;

  field: Field;
  stackX: number;
  stackY: number;
  rocks: Rock[];

  hero: Hero;
  d: Derived;

  // Статистика
  swings: number;
  cutTufts: number;
  cutKg: number;

  // События последнего шага — по ним картинка и звук делают эффекты. В хеш не входят.
  swing: SwingEvent | null;
  cutIdx: Int32Array;
  cutCount: number;
  /** Сколько ударов ещё требует трава прямо по курсу (0 — травы впереди нет). */
  needAhead: number;
}

export function createGame(seed: number, tuning: Tuning = DEFAULT_TUNING): Game {
  const t = cloneTuning(tuning);
  const level = generateLevel(seed, t);
  const g: Game = {
    seed,
    tuning: t,
    tick: 0,
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
    d: derive(t),
    swings: 0,
    cutTufts: 0,
    cutKg: 0,
    swing: null,
    cutIdx: new Int32Array(1024),
    cutCount: 0,
    needAhead: 0,
  };
  return g;
}

export function derive(t: Tuning): Derived {
  const swingTicks = Math.max(1, Math.round(t.swingPeriod * TICK_RATE));
  return {
    reach: t.reach,
    reach2: t.reach * t.reach,
    arcDeg: t.arcDeg,
    arcCos: cosDeg(t.arcDeg / 2),
    probeCos: cosDeg(t.probeDeg),
    swingTicks,
    damage: Math.max(1, Math.round(t.damage)),
    mowSpeed: (t.stepFrac * t.reach) / (swingTicks * DT),
    wadeSpeed: t.runSpeed * t.wadeFactor,
  };
}

/** Один шаг симуляции (1/30 секунды). */
export function step(g: Game, input: number): void {
  const h = g.hero;
  const t = g.tuning;
  const d = g.d;

  g.tick++;
  g.swing = null;
  g.cutCount = 0;
  h.px = h.x;
  h.py = h.y;

  const moving = input >= 1 && input <= DIR_COUNT;
  if (moving) h.dir = input - 1;

  // 1. Коса: бьёт сама, как только готова и в секторе есть трава.
  if (h.swingCd > 0) h.swingCd--;
  scythe(g);

  if (!moving) {
    h.speed = 0;
    return;
  }

  // 2. Скорость — наименьшая из трёх: бег, шаг косаря, брод по стоячей траве.
  let target = t.runSpeed;
  if (g.needAhead > 0) {
    const pace = d.mowSpeed / g.needAhead;
    if (pace < target) target = pace;
  }
  if (standingWithin(g.field, h.x, h.y, t.wadeRadius) && d.wadeSpeed < target) target = d.wadeSpeed;

  if (target < h.speed) {
    const slowed = h.speed - t.accel * 2 * DT;
    h.speed = slowed < target ? target : slowed;
  } else {
    const sped = h.speed + t.accel * DT;
    h.speed = sped > target ? target : sped;
  }

  // 3. Перемещение, края поля и препятствия.
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
 * Обходит кустики в радиусе косы. Если коса готова и в секторе взмаха есть трава — бьёт.
 * Заодно считает, сколько ударов ещё требует трава в узком секторе прямо по курсу:
 * от этого зависит шаг косаря.
 */
function scythe(g: Game): void {
  const h = g.hero;
  const d = g.d;
  const f = g.field;
  const fx = DIR_X[h.dir]!;
  const fy = DIR_Y[h.dir]!;
  const ready = h.swingCd === 0;
  let cut = 0;
  let hit = 0;
  let need = 0;

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
            g.cutKg += g.tuning.grassYield[f.type[i]!]!;
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
    g.swing = { x: h.x, y: h.y, dir: h.dir, reach: d.reach, arcDeg: d.arcDeg, cut };
  }
}
