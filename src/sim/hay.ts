// Сено: кучки на поле, сушка, сбор в охапку и выгрузка в стог.

import type { Game } from './game.ts';
import { STACK_RADIUS } from './gen.ts';
import { DT } from './tuning.ts';

export interface Pile {
  id: number;
  x: number;
  y: number;
  mass: number; // кг
  dry: number; // 0 — только скошена, 1 — готова
}

export interface PickEvent {
  id: number;
  x: number;
  y: number;
  kg: number;
  removed: boolean; // кучку забрали целиком
}

export const MAX_PILES = 1500;
const MERGE_RADIUS = 0.6; // свежие кучки ближе этого сливаются в одну
const MERGE_MAX_DRY = 0.25; // сливаются только недавно скошенные

/** Сушка: все несухие кучки сохнут с силой sun (1 — полное солнце, 0 — не сохнут). */
export function dryPiles(g: Game, sun: number): void {
  if (sun <= 0) return;
  const rate = (DT / g.tuning.dryTime) * sun;
  const piles = g.piles;
  for (let i = 0; i < piles.length; i++) {
    const p = piles[i]!;
    if (p.dry >= 1) continue;
    p.dry += rate;
    if (p.dry >= 1) {
      p.dry = 1;
      g.readyIds.push(p.id);
    }
  }
}

/** Положить скошенное сено кучкой в точку (x, y). */
export function dropPile(g: Game, kg: number, px: number, py: number): void {
  const t = g.tuning;
  let x = px;
  let y = py;
  const lo = 0.3;
  const hi = t.fieldSize - 0.3;
  x = x < lo ? lo : x > hi ? hi : x;
  y = y < lo ? lo : y > hi ? hi : y;

  // Не класть кучку внутрь стога или камня.
  const pushOut = (cx: number, cy: number, r: number) => {
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return;
    const d = Math.sqrt(d2);
    if (d > 1e-6) {
      x = cx + (dx / d) * r;
      y = cy + (dy / d) * r;
    } else {
      x = cx + r;
    }
  };
  pushOut(g.stackX, g.stackY, STACK_RADIUS + 0.3);
  for (let i = 0; i < g.rocks.length; i++) {
    const rock = g.rocks[i]!;
    pushOut(rock.x, rock.y, rock.r + 0.25);
  }

  const piles = g.piles;
  const r2 = MERGE_RADIUS * MERGE_RADIUS;
  for (let i = 0; i < piles.length; i++) {
    const p = piles[i]!;
    if (p.dry > MERGE_MAX_DRY) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy <= r2) {
      mergeInto(p, kg);
      return;
    }
  }
  if (piles.length >= MAX_PILES) {
    mergeInto(piles[piles.length - 1]!, kg);
    return;
  }
  const id = g.nextPileId++;
  piles.push({ id, x, y, mass: kg, dry: 0 });
  g.newPileIds.push(id);
}

/** Добавить свежего сена в кучку: её сушка откатывается пропорционально массе. */
function mergeInto(p: Pile, kg: number): void {
  const total = p.mass + kg;
  p.dry = (p.dry * p.mass) / total;
  p.mass = total;
}

/** Готовые кучки рядом с героем сами идут в охапку, пока в ней есть место. */
export function pickUp(g: Game): void {
  const h = g.hero;
  const cap = g.d.carryCap;
  if (h.load >= cap) return;
  const r = g.tuning.pickupRadius;
  const r2 = r * r;
  const piles = g.piles;
  let write = 0;
  for (let i = 0; i < piles.length; i++) {
    const p = piles[i]!;
    let keep = true;
    if (p.dry >= 1 && h.load < cap) {
      const dx = p.x - h.x;
      const dy = p.y - h.y;
      if (dx * dx + dy * dy <= r2) {
        const room = cap - h.load;
        let kg: number;
        if (p.mass <= room) {
          kg = p.mass;
          h.load += kg;
          if (h.load > cap) h.load = cap;
          keep = false;
        } else {
          kg = room;
          p.mass -= room;
          h.load = cap;
        }
        g.picks.push({ id: p.id, x: p.x, y: p.y, kg, removed: !keep });
      }
    }
    if (keep) piles[write++] = p;
  }
  piles.length = write;
}

/** У стога охапка выгружается сама. Возвращает, сколько кг выгружено за шаг. */
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

/** Сколько сена лежит на поле. */
export function groundKg(g: Game): number {
  let kg = 0;
  for (let i = 0; i < g.piles.length; i++) kg += g.piles[i]!.mass;
  return kg;
}
