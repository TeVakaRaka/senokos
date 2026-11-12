// Сено. Скошенная трава остаётся лежать там, где её срезали, и сохнет на месте.
// Сухое сено грабли сгребают в тюк, который косарь тащит за собой; у стога тюк выгружается.

import { cellCoord } from './field.ts';
import type { Game } from './game.ts';
import { DT } from './tuning.ts';

/** Высохло ли скошенное на месте кустика i. */
export function isDry(g: Game, i: number): boolean {
  return g.tick - g.field.cutTick[i]! >= g.dryTicks;
}

/** Доля высыхания 0…1 (для бота и подсказок). */
export function dryness(g: Game, i: number): number {
  const d = (g.tick - g.field.cutTick[i]!) / g.dryTicks;
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/**
 * Грабли: сухое сено рядом с героем уходит в тюк, пока в нём есть место.
 * Сырое остаётся лежать. Индексы начисто сгребённых кустиков попадают в rakeIdx.
 */
export function rake(g: Game): void {
  const h = g.hero;
  const cap = g.d.carryCap;
  if (h.load >= cap) return;
  const f = g.field;
  const r = g.d.rakeRadius;
  const r2 = r * r;
  const c0 = cellCoord(f.cols, h.x - r);
  const c1 = cellCoord(f.cols, h.x + r);
  const r0 = cellCoord(f.cols, h.y - r);
  const r1 = cellCoord(f.cols, h.y + r);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const cell = cy * f.cols + cx;
      const end = f.cellStart[cell + 1]!;
      for (let k = f.cellStart[cell]!; k < end; k++) {
        const i = f.cellItems[k]!;
        const hay = f.hay[i]!;
        if (hay <= 0) continue;
        if (g.tick - f.cutTick[i]! < g.dryTicks) continue; // ещё сырое
        const dx = f.x[i]! - h.x;
        const dy = f.y[i]! - h.y;
        if (dx * dx + dy * dy > r2) continue;

        const room = cap - h.load;
        if (hay <= room) {
          h.load += hay;
          g.rakedKg += hay;
          f.hay[i] = 0;
          if (g.rakeCount < g.rakeIdx.length) g.rakeIdx[g.rakeCount++] = i;
          if (h.load >= cap) {
            h.load = cap;
            return;
          }
        } else {
          // Тюк полон: с этого кустика взяли часть, остальное лежит дальше.
          f.hay[i] = hay - room;
          g.rakedKg += room;
          h.load = cap;
          return;
        }
      }
    }
  }
}

/** У стога тюк выгружается сам. Возвращает, сколько кг выгружено за шаг. */
export function unload(g: Game): number {
  const h = g.hero;
  if (h.load <= 0) return 0;
  const dx = h.x - g.stackX;
  const dy = h.y - g.stackY;
  const r = g.tuning.stackReach;
  if (dx * dx + dy * dy > r * r) return 0;
  const chunk = g.tuning.unloadRate * DT;
  let kg: number;
  if (h.load <= chunk) {
    kg = h.load;
    h.load = 0;
  } else {
    kg = chunk;
    h.load -= chunk;
  }
  g.stacked += kg;
  return kg;
}

/** Сколько сена лежит на поле (и сырого, и сухого). */
export function groundKg(g: Game): number {
  const hay = g.field.hay;
  let kg = 0;
  for (let i = 0; i < hay.length; i++) kg += hay[i]!;
  return kg;
}

/** Сколько на поле сухого сена, готового к граблям. */
export function dryKg(g: Game): number {
  const f = g.field;
  let kg = 0;
  for (let i = 0; i < f.count; i++) {
    if (f.hay[i]! > 0 && g.tick - f.cutTick[i]! >= g.dryTicks) kg += f.hay[i]!;
  }
  return kg;
}
