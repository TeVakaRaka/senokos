// Бот-автопилот. Играет по тем же правилам, что человек: отдаёт симуляции один байт ввода
// за шаг. Нужен для тестов, подбора баланса и показа игры без рук.
//
// Порядок решений: выбрать перк → отнести полную охапку в стог → подобрать готовые кучки →
// косить полосами туда-обратно (пока скошенное ещё успеет высохнуть до вечера).

import { dirFromVector } from './dirs.ts';
import { nearestStanding, standingInRect } from './field.ts';
import type { Game } from './game.ts';
import { CHOICE_BASE, PERK_ARC, PERK_CARRY, PERK_RATE, PERK_REACH } from './perks.ts';
import { Rng } from './rng.ts';
import { DT } from './tuning.ts';

/** Каким перкам бот отдаёт предпочтение (по порядку). */
const PERK_PRIORITY = [PERK_CARRY, PERK_REACH, PERK_RATE, PERK_ARC];

export interface Bot {
  rng: Rng;
  started: boolean;
  dir: number; // текущее направление 0…63 или −1
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

  // 1. В стог: охапка полная, или набрано прилично и рядом ничего готового, или вечер.
  if (h.load > 0) {
    const nearReady = nearestReadyPile(g, 8);
    const loaded = h.load >= cap - 1e-9;
    const enough = h.load >= cap * 0.5 && nearReady < 0;
    const lateDay = timeLeft < stackDist / (t.runSpeed * 0.5) + 3;
    const nothingLeft = nearestReadyPile(g, Infinity) < 0 && timeLeft < t.dryTime + 4;
    if (loaded || enough || lateDay || nothingLeft) {
      if (stackDist <= t.stackReach - 0.15) return idle(b); // выгружается
      return go(b, sx, sy);
    }
  }

  // 2. Подобрать готовую кучку.
  const pile = nearestReadyPile(g, Infinity);
  if (pile >= 0) {
    const p = g.piles[pile]!;
    return go(b, p.x - h.x, p.y - h.y);
  }

  // 3. Косить, если скошенное успеет высохнуть до конца дня.
  if (timeLeft > t.dryTime + 6 && g.field.standing > 0) return mowLanes(g, b);

  // 4. Делать нечего: ждать у стога, пока досохнут кучки.
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

/** Индекс ближайшей готовой кучки не дальше maxDist или −1. */
function nearestReadyPile(g: Game, maxDist: number): number {
  const h = g.hero;
  let best = -1;
  let bestD2 = maxDist * maxDist;
  for (let i = 0; i < g.piles.length; i++) {
    const p = g.piles[i]!;
    if (p.dry < 1) continue;
    const dx = p.x - h.x;
    const dy = p.y - h.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
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
