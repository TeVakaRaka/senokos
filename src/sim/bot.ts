// Бот-автопилот. Играет по тем же правилам, что человек: отдаёт симуляции один байт ввода
// за шаг. Нужен для тестов, подбора баланса и показа игры без рук.
//
// Косит как человек — полосами туда-обратно: идёт вдоль полосы, в конце переходит
// на соседнюю и разворачивается.

import { dirFromVector } from './dirs.ts';
import { nearestStanding, standingInRect } from './field.ts';
import type { Game } from './game.ts';
import { Rng } from './rng.ts';

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

/** Ввод бота на этот шаг: 0 или 1…64. */
export function botInput(g: Game, b: Bot): number {
  const h = g.hero;
  const size = g.field.size;
  const spacing = g.d.reach * 0.9; // ширина сплошной сердцевины полосы
  // Полоса считается законченной, когда пуста её середина. Редкие кустики по краям
  // добьёт соседняя полоса; гоняться за ними на бегу — пустая трата дня.
  const half = spacing * 0.3;

  if (!b.started) {
    b.started = true;
    b.laneY = h.y;
  }
  if (g.field.standing === 0) {
    b.dir = -1;
    return 0;
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

  // Раз в несколько шагов проверяет, не кончилась ли полоса.
  if (b.think > 0) {
    b.think--;
  } else {
    b.think = 5;
    let tries = 0;
    while (!grassAlongLane(g, b, b.laneSign, half) && tries < 64) {
      tries++;
      // В этой полосе по ходу пусто. Может, трава осталась позади?
      if (grassAlongLane(g, b, -b.laneSign, half)) {
        b.laneSign = -b.laneSign;
        break;
      }
      // Переход на соседнюю полосу с разворотом; у края поля — обратно через всё поле.
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
      if (target < 0) {
        b.dir = -1;
        return 0;
      }
      b.laneY = g.field.y[target]!;
      b.laneSign = g.field.x[target]! >= h.x ? 1 : -1;
    }
  }

  // Держит линию полосы: целится в точку впереди на этой линии.
  b.dir = dirFromVector(b.laneSign * 2.5, b.laneY - h.y);
  return b.dir + 1;
}
