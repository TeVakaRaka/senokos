// Дождь. Раз в день через поле проходит туча: путь и время задаёт зерно. Скошенное сено под
// ней мокнет — сохнуть начинает заново, когда туча уйдёт, а мокрое грабли не берут. Сено
// в тюке, в стоге и в ларьке дождя не боится.

import { cellCoord } from './field.ts';
import type { Game } from './game.ts';

/** Туча: круг радиуса r, который летит по прямой с шага from по шаг to. */
export interface Rain {
  x0: number; // где центр тучи на шаге from
  y0: number;
  vx: number; // смещение за шаг, м
  vy: number;
  r: number;
  from: number;
  to: number;
}

/** Идёт ли сейчас дождь. */
export function raining(g: Game): boolean {
  return g.rain !== null && g.tick >= g.rain.from && g.tick <= g.rain.to;
}

/** Центр тучи по x на этом шаге (вызывать, только когда дождь идёт или вот-вот начнётся). */
export function rainX(g: Game): number {
  const rain = g.rain!;
  return rain.x0 + rain.vx * (g.tick - rain.from);
}

/** Центр тучи по y на этом шаге. */
export function rainY(g: Game): number {
  const rain = g.rain!;
  return rain.y0 + rain.vy * (g.tick - rain.from);
}

/** Намочить скошенное под тучей: оно сохнет заново с этого шага. */
export function soak(g: Game): void {
  if (!raining(g)) return;
  const rain = g.rain!;
  const cx = rainX(g);
  const cy = rainY(g);
  const f = g.field;
  if (cx + rain.r < 0 || cy + rain.r < 0 || cx - rain.r > f.size || cy - rain.r > f.size) return;
  const r2 = rain.r * rain.r;
  const c0 = cellCoord(f.cols, cx - rain.r);
  const c1 = cellCoord(f.cols, cx + rain.r);
  const r0 = cellCoord(f.cols, cy - rain.r);
  const r1 = cellCoord(f.cols, cy + rain.r);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const cell = row * f.cols + col;
      const end = f.cellStart[cell + 1]!;
      for (let k = f.cellStart[cell]!; k < end; k++) {
        const i = f.cellItems[k]!;
        if (f.hay[i]! <= 0) continue;
        const dx = f.x[i]! - cx;
        const dy = f.y[i]! - cy;
        if (dx * dx + dy * dy <= r2) f.cutTick[i] = g.tick;
      }
    }
  }
}
