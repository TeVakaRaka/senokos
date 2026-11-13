// Сено. Скошенная трава остаётся лежать там, где её срезали, и сохнет на месте.
// Сухое сено грабли сгребают в тюк, который косарь тащит за собой; у своего стога тюк
// выгружается. В PvP тюк можно выронить (если подрезали ноги) и подобрать чужой,
// а граблями — вытаскивать сено из чужого стога.

import { giveShop } from './arms.ts';
import { allies } from './combat.ts';
import { giveKennel } from './dog.ts';
import { cellCoord } from './field.ts';
import type { Game, Player } from './game.ts';
import { spring, trapAt } from './trap.ts';
import { DT } from './tuning.ts';

/** Тюк, выроненный на землю. */
export interface Drop {
  id: number;
  x: number;
  y: number;
  kg: number;
}

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
 * Грабли: сухое сено рядом с игроком уходит в его тюк, пока в нём есть место.
 * Сырое остаётся лежать. Индексы начисто сгребённых кустиков попадают в rakeIdx.
 */
export function rake(g: Game, p: Player): void {
  p.rakeFrom = g.rakeCount;
  p.rakeTo = g.rakeCount;
  const cap = p.d.carryCap;
  if (p.load >= cap) return;
  const f = g.field;
  const r = p.d.rakeRadius;
  const r2 = r * r;
  const c0 = cellCoord(f.cols, p.x - r);
  const c1 = cellCoord(f.cols, p.x + r);
  const r0 = cellCoord(f.cols, p.y - r);
  const r1 = cellCoord(f.cols, p.y + r);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const cell = cy * f.cols + cx;
      const end = f.cellStart[cell + 1]!;
      for (let k = f.cellStart[cell]!; k < end; k++) {
        const i = f.cellItems[k]!;
        const hay = f.hay[i]!;
        if (hay <= 0) continue;
        if (g.tick - f.cutTick[i]! < g.dryTicks) continue; // ещё сырое
        const dx = f.x[i]! - p.x;
        const dy = f.y[i]! - p.y;
        if (dx * dx + dy * dy > r2) continue;

        const room = cap - p.load;
        if (hay <= room) {
          p.load += hay;
          p.rakedKg += hay;
          f.hay[i] = 0;
          if (g.rakeCount < g.rakeIdx.length) g.rakeIdx[g.rakeCount++] = i;
          p.rakeTo = g.rakeCount;
          if (p.load >= cap) {
            p.load = cap;
            return;
          }
        } else {
          // Тюк полон: с этого кустика взяли часть, остальное лежит дальше.
          f.hay[i] = hay - room;
          p.rakedKg += room;
          p.load = cap;
          return;
        }
      }
    }
  }
}

/** Упавшие тюки: кто прошёл рядом и у кого есть место — забирает (сколько влезет). */
export function pickDrops(g: Game, p: Player): void {
  const drops = g.drops;
  if (drops.length === 0) return;
  const cap = p.d.carryCap;
  const r = g.tuning.dropRadius;
  const r2 = r * r;
  let write = 0;
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i]!;
    let keep = true;
    if (p.load < cap) {
      const dx = d.x - p.x;
      const dy = d.y - p.y;
      if (dx * dx + dy * dy <= r2) {
        const room = cap - p.load;
        if (d.kg <= room) {
          p.load += d.kg;
          p.pickedKg += d.kg;
          if (p.load > cap) p.load = cap;
          keep = false;
        } else {
          d.kg -= room;
          p.pickedKg += room;
          p.load = cap;
        }
      }
    }
    if (keep) drops[write++] = d;
  }
  drops.length = write;
}

/**
 * Кража: у чужого стога грабли вытаскивают из него сено в свой тюк. У своих (в команде)
 * не крадут. Если у стога взведён капкан, первый же вор попадает в него и остаётся ни с чем.
 */
export function raid(g: Game, p: Player): void {
  const cap = p.d.carryCap;
  const r = g.tuning.stackReach;
  let left = g.tuning.stealRate * DT; // сколько можно утащить за шаг (стог бывает общим на двоих)
  for (let k = 0; k < g.players.length; k++) {
    const q = g.players[k]!;
    if (q === p || allies(g, p, q) || q.stacked <= 0 || p.load >= cap || left <= 0) continue;
    const dx = p.x - q.stackX;
    const dy = p.y - q.stackY;
    if (dx * dx + dy * dy > r * r) continue;
    const owner = trapAt(g, q);
    if (owner) {
      spring(g, owner, p);
      return;
    }
    let kg = left;
    if (kg > cap - p.load) kg = cap - p.load;
    if (kg > q.stacked) kg = q.stacked;
    left -= kg;
    q.stacked -= kg;
    if (q.stacked < 1e-9) q.stacked = 0;
    q.robbed += kg;
    p.load += kg;
    if (p.load > cap - 1e-9) p.load = cap;
    p.stolenKg += kg;
    p.stolen += kg;
  }
}

/**
 * У своего стога тюк выгружается сам, на ходу. У прилавка ларька — в ларёк, у своей будки —
 * в будку, но только если там остановиться: на ходу сено туда не уходит, чтобы не отдать
 * его случайно, пробегая мимо.
 */
export function unload(g: Game, p: Player): void {
  if (p.load <= 0) return;
  const dx = p.x - p.stackX;
  const dy = p.y - p.stackY;
  const r = g.tuning.stackReach;
  if (dx * dx + dy * dy > r * r) {
    if (!giveShop(g, p)) giveKennel(g, p);
    return;
  }
  const chunk = g.tuning.unloadRate * DT;
  let kg: number;
  if (p.load <= chunk) {
    kg = p.load;
    p.load = 0;
  } else {
    kg = chunk;
    p.load -= chunk;
  }
  p.stacked += kg;
  p.delivered += kg;
  p.unloadedKg = kg;
}

/** Сколько сена лежит на поле (и сырого, и сухого), без упавших тюков. */
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

/** Сколько сена в упавших тюках. */
export function dropsKg(g: Game): number {
  let kg = 0;
  for (let i = 0; i < g.drops.length; i++) kg += g.drops[i]!.kg;
  return kg;
}
