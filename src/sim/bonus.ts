// Находки на поле. Появляются по расписанию, которое задаёт зерно (когда, где и что), и лежат,
// пока кто-нибудь не пройдёт рядом. Точило — коса бьёт чаще; сапоги — бег быстрее; спички —
// одна попытка поджечь чужой стог (fire.ts). Бывают только в игре на нескольких.

import type { Game, Player } from './game.ts';

export const BONUS_WHET = 0;
export const BONUS_BOOTS = 1;
export const BONUS_MATCHES = 2;
export const BONUS_KINDS = 3;

/** Находка, которая лежит на поле. */
export interface Bonus {
  id: number;
  kind: number;
  x: number;
  y: number;
}

/** Строка расписания: на каком шаге, где и что появится. */
export interface BonusPlan {
  tick: number;
  kind: number;
  x: number;
  y: number;
}

/** Выложить на поле то, чему пришло время. */
export function spawnBonuses(g: Game): void {
  while (g.bonusNext < g.bonusPlan.length && g.bonusPlan[g.bonusNext]!.tick <= g.tick) {
    const plan = g.bonusPlan[g.bonusNext]!;
    g.bonusNext++;
    g.bonuses.push({ id: g.bonusNext, kind: plan.kind, x: plan.x, y: plan.y });
    g.bonusBorn = plan.kind;
  }
}

/** Игрок прошёл рядом с находкой — она его. Вторые спички не берёт: оставляет другим. */
export function pickBonus(g: Game, p: Player): void {
  const list = g.bonuses;
  if (list.length === 0) return;
  const r = g.tuning.dropRadius;
  for (let i = 0; i < list.length; i++) {
    const b = list[i]!;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    if (dx * dx + dy * dy > r * r) continue;
    if (b.kind === BONUS_MATCHES && p.matches) continue;
    if (b.kind === BONUS_WHET) p.sharp = g.bonusTicks;
    else if (b.kind === BONUS_BOOTS) p.boots = g.bonusTicks;
    else p.matches = true;
    p.bonus = b.kind;
    list.splice(i, 1);
    return;
  }
}
