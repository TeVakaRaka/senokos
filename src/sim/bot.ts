// Бот-автопилот. Играет по тем же правилам, что человек: отдаёт симуляции один байт ввода
// за шаг. Нужен для тестов, подбора баланса и показа игры без рук.
//
// Порядок решений: выбрать перк → отвезти полный тюк в стог → сгрести сухое сено, когда его
// набралось на тюк → косить полосами туда-обратно (пока скошенное успеет высохнуть до вечера).

import { dirFromVector } from './dirs.ts';
import { nearestStanding, nearestTuft, standingInRect } from './field.ts';
import type { Game } from './game.ts';
import { dryKg } from './hay.ts';
import { CHOICE_BASE, PERK_ARC, PERK_CARRY, PERK_RAKE, PERK_RATE, PERK_REACH } from './perks.ts';
import { Rng } from './rng.ts';
import { DT } from './tuning.ts';

/** Каким перкам бот отдаёт предпочтение (по порядку). */
const PERK_PRIORITY = [PERK_CARRY, PERK_REACH, PERK_RATE, PERK_RAKE, PERK_ARC];

export interface Bot {
  rng: Rng;
  started: boolean;
  dir: number; // текущее направление 0…63 или −1
  raking: boolean; // сейчас сгребает сено, а не косит
  laneY: number; // линия текущей полосы
  laneSign: number; // +1 — идём вдоль +x, −1 — вдоль −x
  sweep: number; // +1 — следующие полосы в сторону +y, −1 — в сторону −y
  think: number; // шагов до следующей проверки полосы
  stuck: number; // шагов без движения
  escape: number; // шагов обхода препятствия
}

export function createBot(seed: number): Bot {
  return {
    rng: new Rng((seed ^ 0x2545f491) >>> 0),
    started: false,
    dir: -1,
    raking: false,
    laneY: 0,
    laneSign: 1,
    sweep: 1,
    think: 0,
    stuck: 0,
    escape: 0,
  };
}

/** Ввод бота на этот шаг: 0, 1…64 или выбор перка. */
export function botInput(g: Game, b: Bot): number {
  if (g.offer !== null) return CHOICE_BASE + pickPerk(g.offer);
  if (g.over) return 0;

  const h = g.hero;
  if (!b.started) {
    b.started = true;
    b.laneY = h.y;
  }

  // Застрял (упёрся в камень или стог) — несколько шагов идёт вбок.
  const moved = (h.x - h.px) * (h.x - h.px) + (h.y - h.py) * (h.y - h.py);
  if (b.dir >= 0 && moved < 1e-6) b.stuck++;
  else b.stuck = 0;
  if (b.stuck > 12) {
    b.stuck = 0;
    b.escape = 18;
    b.dir = (b.dir + 12 + b.rng.int(9)) % 64;
  }
  if (b.escape > 0) {
    b.escape--;
    return b.dir + 1;
  }

  const t = g.tuning;
  const cap = g.d.carryCap;
  const timeLeft = (g.dayTicks - g.tick) * DT;
  const sx = g.stackX - h.x;
  const sy = g.stackY - h.y;
  const stackDist = Math.sqrt(sx * sx + sy * sy);

  const full = h.load >= cap - 1e-9;

  // 1. В стог: тюк полон или день кончается, а в тюке что-то есть.
  const lateDay = timeLeft < stackDist / (t.runSpeed * 0.6) + 2;
  if (full || (h.load > 0 && lateDay)) {
    b.raking = false;
    if (stackDist <= t.stackReach - 0.15) return idle(b); // выгружается
    return go(b, sx, sy);
  }

  // 2. Грести: когда сухого сена набралось больше чем на полтюка (или сколько в тюк ещё
  // влезет), а под вечер — пока оно вообще есть.
  const dry = dryKg(g);
  const worth = Math.min(cap - h.load, cap * 0.6);
  if (b.raking) {
    if (dry <= 1e-9) b.raking = false;
  } else if (dry >= worth || (dry > 0 && timeLeft < t.dryTime + 8)) {
    b.raking = true;
  }
  if (b.raking) {
    const target = nearestDry(g);
    if (target >= 0) return go(b, g.field.x[target]! - h.x, g.field.y[target]! - h.y);
    b.raking = false;
  }

  // 3. Сгребать больше нечего, а в тюке что-то есть — отвезти.
  if (h.load > 0) {
    if (stackDist <= t.stackReach - 0.15) return idle(b);
    return go(b, sx, sy);
  }

  // 4. Косить, если скошенное успеет высохнуть до конца дня.
  if (timeLeft > t.dryTime + 6 && g.field.standing > 0) return mowLanes(g, b);

  // 5. Делать нечего: ждать у стога, пока досохнет.
  if (stackDist > t.stackReach) return go(b, sx, sy);
  return idle(b);
}

function pickPerk(offer: readonly number[]): number {
  for (const want of PERK_PRIORITY) {
    const index = offer.indexOf(want);
    if (index >= 0) return index;
  }
  return 0;
}

function go(b: Bot, dx: number, dy: number): number {
  b.dir = dirFromVector(dx, dy);
  return b.dir + 1;
}

function idle(b: Bot): number {
  b.dir = -1;
  return 0;
}

/** Индекс ближайшего кустика с сухим сеном или −1. */
function nearestDry(g: Game): number {
  const f = g.field;
  return nearestTuft(f, g.hero.x, g.hero.y, Infinity, (i) => f.hay[i]! > 0 && g.tick - f.cutTick[i]! >= g.dryTicks);
}

/**
 * Есть ли трава в полосе по ходу от героя до края поля.
 * Кустики вплотную к герою не считаются: коса бьёт сектором вперёд и до них,
 * идя прямо, не дотянется — иначе бот вечно толкался бы в край поля.
 */
function grassAlongLane(g: Game, b: Bot, sign: number, half: number): boolean {
  const h = g.hero;
  const skip = 0.8;
  const x0 = sign > 0 ? h.x + skip : 0;
  const x1 = sign > 0 ? g.field.size : h.x - skip;
  return standingInRect(g.field, x0, x1, b.laneY - half, b.laneY + half);
}

/** Косит полосами туда-обратно: в конце полосы переходит на соседнюю и разворачивается. */
function mowLanes(g: Game, b: Bot): number {
  const h = g.hero;
  const size = g.field.size;
  const spacing = g.d.reach * 0.9; // ширина сплошной сердцевины полосы
  // Полоса считается законченной, когда пуста её середина. Редкие кустики по краям
  // добьёт соседняя полоса; гоняться за ними на бегу — пустая трата дня.
  const half = spacing * 0.3;

  if (b.think > 0) {
    b.think--;
  } else {
    b.think = 5;
    let tries = 0;
    while (!grassAlongLane(g, b, b.laneSign, half) && tries < 64) {
      tries++;
      if (grassAlongLane(g, b, -b.laneSign, half)) {
        b.laneSign = -b.laneSign;
        break;
      }
      let next = b.laneY + b.sweep * spacing;
      if (next < half || next > size - half) {
        b.sweep = -b.sweep;
        next = b.laneY + b.sweep * spacing;
      }
      b.laneY = next;
      b.laneSign = -b.laneSign;
    }
    if (tries >= 64) {
      // Полосами ничего не нашлось (остались редкие кустики) — идём к ближайшему.
      const target = nearestStanding(g.field, h.x, h.y);
      if (target < 0) return idle(b);
      b.laneY = g.field.y[target]!;
      b.laneSign = g.field.x[target]! >= h.x ? 1 : -1;
    }
  }

  // Держит линию полосы: целится в точку впереди на этой линии.
  b.dir = dirFromVector(b.laneSign * 2.5, b.laneY - h.y);
  return b.dir + 1;
}
